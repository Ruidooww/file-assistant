using System.Diagnostics;
using System.Text.RegularExpressions;

namespace FileAssistant.ServerTray;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var context = new TrayContext();
        Application.Run(context);
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon _notifyIcon;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _addressItem;
    private readonly ToolStripMenuItem _logDirItem;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly ServerConfig _config;

    public TrayContext()
    {
        _config = ServerConfig.Load(AppContext.BaseDirectory);
        _statusItem = new ToolStripMenuItem("服务状态：检查中") { Enabled = false };
        _addressItem = new ToolStripMenuItem($"访问地址：{_config.ServerUrl}")
        {
            ToolTipText = "点击打开管理端",
        };
        _addressItem.Click += (_, _) => OpenUrl(_config.AdminUrl);
        _logDirItem = new ToolStripMenuItem($"日志目录：{_config.LogDir}")
        {
            ToolTipText = "点击打开日志目录",
        };
        _logDirItem.Click += (_, _) => OpenFolder(_config.LogDir);

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(_addressItem);
        menu.Items.Add(_logDirItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("打开管理端", null, (_, _) => OpenUrl(_config.AdminUrl));
        menu.Items.Add("打开安装目录", null, (_, _) => OpenFolder(AppContext.BaseDirectory));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("启动服务", null, (_, _) => RunServiceCommand("Start-Service", "启动服务"));
        menu.Items.Add("停止服务", null, (_, _) => RunServiceCommand("Stop-Service", "停止服务"));
        menu.Items.Add("重启服务", null, (_, _) => RunServiceCommand("Restart-Service", "重启服务"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出托盘", null, (_, _) => ExitThread());

        _notifyIcon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "File Assistant Server",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _notifyIcon.DoubleClick += (_, _) => OpenUrl(_config.AdminUrl);

        _timer = new System.Windows.Forms.Timer { Interval = 10000 };
        _timer.Tick += (_, _) => RefreshStatus();
        _timer.Start();

        RefreshStatus();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _timer.Dispose();
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
        }
        base.Dispose(disposing);
    }

    private void RefreshStatus()
    {
        var status = QueryServiceStatus(_config.ServiceName);
        _statusItem.Text = $"服务状态：{status}";
        _notifyIcon.Text = TrimNotifyText($"File Assistant Server - {status}");
    }

    private static string QueryServiceStatus(string serviceName)
    {
        try
        {
            using var process = StartHidden("sc.exe", $"query \"{serviceName}\"");
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(3000);
            if (process.ExitCode != 0) return "未安装";
            if (output.Contains("RUNNING", StringComparison.OrdinalIgnoreCase)) return "运行中";
            if (output.Contains("STOPPED", StringComparison.OrdinalIgnoreCase)) return "已停止";
            if (output.Contains("START_PENDING", StringComparison.OrdinalIgnoreCase)) return "启动中";
            if (output.Contains("STOP_PENDING", StringComparison.OrdinalIgnoreCase)) return "停止中";
            return "未知";
        }
        catch
        {
            return "未知";
        }
    }

    private void RunServiceCommand(string command, string title)
    {
        try
        {
            var script = $"{command} -Name '{EscapePowerShellSingleQuoted(_config.ServiceName)}' -ErrorAction Stop";
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                UseShellExecute = true,
                Verb = "runas",
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-ExecutionPolicy");
            psi.ArgumentList.Add("Bypass");
            psi.ArgumentList.Add("-Command");
            psi.ArgumentList.Add(script);
            Process.Start(psi);
            _notifyIcon.ShowBalloonTip(3000, title, "命令已提交，稍后会刷新服务状态。", ToolTipIcon.Info);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"执行失败：{ex.Message}", title, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            Task.Delay(3000).ContinueWith(_ => _notifyIcon.ContextMenuStrip?.BeginInvoke((Action)RefreshStatus));
        }
    }

    private static Process StartHidden(string fileName, string arguments)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        return Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start {fileName}");
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
    }

    private static void OpenFolder(string folder)
    {
        Directory.CreateDirectory(folder);
        Process.Start(new ProcessStartInfo { FileName = folder, UseShellExecute = true });
    }

    private static string EscapePowerShellSingleQuoted(string value)
    {
        return value.Replace("'", "''", StringComparison.Ordinal);
    }

    private static string TrimNotifyText(string value)
    {
        return value.Length <= 63 ? value : value[..63];
    }
}

internal sealed record ServerConfig(string ServiceName, string ServerUrl, string AdminUrl, string LogDir)
{
    public static ServerConfig Load(string baseDir)
    {
        var configPath = Path.Combine(baseDir, "deploy", "server", "config.ps1");
        var serviceName = "FileAssistantServer";
        var publicUrl = "http://localhost:5177";
        var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FileAssistantServer", "logs");

        if (File.Exists(configPath))
        {
            var text = File.ReadAllText(configPath);
            serviceName = ReadString(text, "ServiceName") ?? serviceName;
            publicUrl = ReadString(text, "PublicServerUrl") ?? publicUrl;
            logDir = ReadString(text, "LogDir") ?? logDir;
        }

        if (!Path.IsPathRooted(logDir))
        {
            logDir = Path.GetFullPath(Path.Combine(baseDir, logDir));
        }

        var serverUrl = NormalizeServerUrl(publicUrl);
        return new ServerConfig(serviceName, serverUrl, BuildAdminUrl(serverUrl), logDir);
    }

    private static string NormalizeServerUrl(string publicUrl)
    {
        var normalized = string.IsNullOrWhiteSpace(publicUrl) ? "http://localhost:5177" : publicUrl.Trim();
        return normalized.TrimEnd('/');
    }

    private static string BuildAdminUrl(string serverUrl)
    {
        return serverUrl.EndsWith("/admin", StringComparison.OrdinalIgnoreCase) ? serverUrl : $"{serverUrl}/admin";
    }

    private static string? ReadString(string text, string key)
    {
        var match = Regex.Match(text, $@"(?m)^\s*{Regex.Escape(key)}\s*=\s*""([^""]*)""");
        return match.Success ? match.Groups[1].Value : null;
    }
}

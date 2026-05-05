using System.Diagnostics;
using System.Drawing;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Windows.Forms;

namespace FileAssistant.ServerSetup;

internal static class Program
{
    private const string DefaultServiceName = "FileAssistantServer";
    private const string DefaultInstallDirName = "FileAssistantServer";
    private static Action<string>? _logSink;

    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            try
            {
                Console.OutputEncoding = Encoding.UTF8;
            }
            catch
            {
                // GUI launches do not always have a console attached.
            }

            var options = SetupOptions.Parse(args);
            if (options.Help)
            {
                ShowHelp();
                return 0;
            }

            if (options.Gui)
            {
                if (!IsAdministrator())
                {
                    return RelaunchElevated(args.Length == 0 ? new[] { "--gui" } : args);
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new SetupForm());
                return 0;
            }

            if (!IsAdministrator() && options.RequiresElevation)
            {
                return RelaunchElevated(args);
            }

            return options.Uninstall ? Uninstall(options) : Install(options);
        }
        catch (Exception ex)
        {
            WriteError(ex.Message);
            WriteError(ex.ToString());
            ShowError(ex.Message);
            return 1;
        }
    }

    private static int Install(SetupOptions options)
    {
        var installDir = options.InstallDir;
        var serviceName = options.ServiceName;
        Directory.CreateDirectory(installDir);

        WriteInfo($"Installing File Assistant Server to: {installDir}");
        ExtractPayload(installDir);
        WriteConfigIfMissing(installDir, options);

        if (options.InstallService)
        {
            InstallService(installDir, serviceName, options);
        }

        CopySelfForUninstall(installDir);
        WriteInfo("Install complete.");
        WriteInfo($"Config: {Path.Combine(installDir, "deploy", "server", "config.ps1")}");
        WriteInfo($"Admin:  http://localhost:{options.Port}/admin");

        if (options.InstallService && !options.StartService)
        {
            WriteInfo("Service was installed but not started. Edit config.ps1, then run:");
            WriteInfo($"  sc.exe start {serviceName}");
        }
        else if (!options.InstallService)
        {
            WriteInfo("Service registration was skipped because --no-service was specified.");
        }

        return 0;
    }

    private static int Uninstall(SetupOptions options)
    {
        var installDir = options.InstallDir;
        var serviceName = options.ServiceName;

        WriteInfo($"Uninstalling service: {serviceName}");
        if (ServiceExists(serviceName))
        {
            Run("sc.exe", new[] { "stop", serviceName }, ignoreExitCode: true);
            Run("sc.exe", new[] { "delete", serviceName }, ignoreExitCode: false);
        }
        else
        {
            WriteInfo("Service does not exist.");
        }

        if (options.RemoveData)
        {
            WriteInfo($"Removing install directory including data: {installDir}");
            if (Directory.Exists(installDir))
            {
                Directory.Delete(installDir, recursive: true);
            }
        }
        else
        {
            WriteInfo("Data was preserved. Remove the install directory manually after backup if needed:");
            WriteInfo($"  {installDir}");
        }

        WriteInfo("Uninstall complete.");
        return 0;
    }

    private static void ExtractPayload(string installDir)
    {
        using var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
        if (payload is null)
        {
            throw new InvalidOperationException("Embedded payload.zip was not found.");
        }

        using var archive = new ZipArchive(payload, ZipArchiveMode.Read);
        var installRoot = Path.GetFullPath(installDir);
        foreach (var entry in archive.Entries)
        {
            var targetPath = Path.GetFullPath(Path.Combine(installDir, entry.FullName));
            if (!targetPath.StartsWith(installRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException($"Unsafe payload entry: {entry.FullName}");
            }

            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(targetPath);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            entry.ExtractToFile(targetPath, overwrite: true);
        }
    }

    private static void WriteConfigIfMissing(string installDir, SetupOptions options)
    {
        var configPath = Path.Combine(installDir, "deploy", "server", "config.ps1");
        if (File.Exists(configPath))
        {
            WriteInfo("Existing config.ps1 was preserved.");
            return;
        }

        var content = $$"""
$FileAssistantConfig = @{
  Port = {{options.Port}}
  AdminUsername = "{{EscapePowerShell(options.AdminUsername)}}"
  AdminPassword = "{{EscapePowerShell(options.AdminPassword)}}"
  AdminToken = "{{EscapePowerShell(options.AdminToken)}}"
  DataDir = "data"
  BackupDir = "backups"
  LogDir = "logs"
  NodePath = "runtime\node\node.exe"
  ServiceName = "{{EscapePowerShell(options.ServiceName)}}"
  PublicServerUrl = "{{EscapePowerShell(options.PublicServerUrl)}}"
  ChunkSizeBytes = {{options.ChunkSizeBytes}}
}
""";
        Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
        File.WriteAllText(configPath, content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        WriteInfo("Created config.ps1.");
    }

    private static void InstallService(string installDir, string serviceName, SetupOptions options)
    {
        var serviceExe = Path.Combine(installDir, "FileAssistantServerService.exe");
        if (!File.Exists(serviceExe))
        {
            throw new FileNotFoundException("Service wrapper was not found in payload.", serviceExe);
        }

        if (ServiceExists(serviceName))
        {
            WriteInfo("Existing service found. Replacing service registration.");
            Run("sc.exe", new[] { "stop", serviceName }, ignoreExitCode: true);
            Run("sc.exe", new[] { "delete", serviceName }, ignoreExitCode: false);
        }

        var binPath = $"\"{serviceExe}\" --service-name \"{serviceName}\" --base-dir \"{installDir}\"";
        Run("sc.exe", new[] { "create", serviceName, "binPath=", binPath, "start=", options.AutoStart ? "auto" : "demand", "DisplayName=", "File Assistant Server" }, ignoreExitCode: false);
        Run("sc.exe", new[] { "description", serviceName, "File Assistant internal file transfer bridge server" }, ignoreExitCode: true);
        WriteInfo($"Service installed: {serviceName}");

        if (options.StartService)
        {
            Run("sc.exe", new[] { "start", serviceName }, ignoreExitCode: false);
            WriteInfo("Service started.");
        }
    }

    private static bool ServiceExists(string serviceName)
    {
        return Run("sc.exe", new[] { "query", serviceName }, ignoreExitCode: true).ExitCode == 0;
    }

    private static CommandResult Run(string fileName, IReadOnlyList<string> args, bool ignoreExitCode)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var arg in args)
        {
            psi.ArgumentList.Add(arg);
        }

        using var process = Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start {fileName}.");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();

        if (!string.IsNullOrWhiteSpace(stdout))
        {
            WriteInfo(stdout.Trim());
        }
        if (!string.IsNullOrWhiteSpace(stderr))
        {
            WriteError(stderr.Trim());
        }
        if (process.ExitCode != 0 && !ignoreExitCode)
        {
            throw new InvalidOperationException($"{fileName} exited with code {process.ExitCode}.");
        }

        return new CommandResult(process.ExitCode, stdout, stderr);
    }

    private static void CopySelfForUninstall(string installDir)
    {
        var current = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(current) || !File.Exists(current))
        {
            return;
        }

        var target = Path.Combine(installDir, "FileAssistantServerSetup.exe");
        if (!string.Equals(Path.GetFullPath(current), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase))
        {
            File.Copy(current, target, overwrite: true);
        }
    }

    private static int RelaunchElevated(string[] args)
    {
        var current = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(current) || !File.Exists(current))
        {
            ShowError("Cannot locate installer executable for elevation.");
            return 1;
        }

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = current,
                Arguments = string.Join(" ", args.Select(QuoteArgument)),
                UseShellExecute = true,
                Verb = "runas",
            };
            Process.Start(psi);
            return 0;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            ShowError("安装需要管理员权限。请在 UAC 提示中选择“是”，或右键以管理员身份运行。");
            return 1;
        }
    }

    private static string QuoteArgument(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }
        if (!value.Any(char.IsWhiteSpace) && !value.Contains('"'))
        {
            return value;
        }
        return "\"" + value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";
    }

    private static bool IsAdministrator()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }

    private static string EscapePowerShell(string value)
    {
        return value.Replace("`", "``", StringComparison.Ordinal).Replace("\"", "`\"", StringComparison.Ordinal);
    }

    private static void WriteInfo(string message)
    {
        _logSink?.Invoke(message);
        try
        {
            Console.WriteLine(message);
        }
        catch
        {
            // Ignore missing console.
        }
    }

    private static void WriteError(string message)
    {
        _logSink?.Invoke("ERROR: " + message);
        try
        {
            Console.Error.WriteLine(message);
        }
        catch
        {
            // Ignore missing console.
        }
    }

    private static string CreateSecret(int byteCount = 24)
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(byteCount))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static void ShowError(string message)
    {
        try
        {
            MessageBox.Show(message, "File Assistant Server Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        catch
        {
            // Ignore when a desktop cannot be opened.
        }
    }

    private static void ShowHelp()
    {
        var text = """
FileAssistantServerSetup.exe [options]

Double-click without options to open the graphical installer.

Install options:
  --install-dir <path>       Default: C:\Program Files\FileAssistantServer
  --service-name <name>      Default: FileAssistantServer
  --port <number>            Default: 5177
  --admin-username <name>    Default: admin
  --admin-password <value>   Default: change-this-password-before-production
  --admin-token <value>      Default: change-this-legacy-token
  --public-url <url>         Default: http://SERVER-IP:5177
  --auto-start               Configure service startup as automatic
  --start                    Start service after install
  --no-service               Extract files and config only

Uninstall options:
  --uninstall
  --remove-data              Delete install directory including data
""";
        WriteInfo(text);
        if (Environment.UserInteractive)
        {
            MessageBox.Show(text, "File Assistant Server Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private sealed record CommandResult(int ExitCode, string Stdout, string Stderr);

    private sealed class SetupForm : Form
    {
        private readonly TextBox _installDir = new() { Dock = DockStyle.Fill };
        private readonly TextBox _serviceName = new() { Dock = DockStyle.Fill };
        private readonly NumericUpDown _port = new() { Dock = DockStyle.Left, Minimum = 1, Maximum = 65535, Width = 120 };
        private readonly TextBox _adminUsername = new() { Dock = DockStyle.Fill };
        private readonly TextBox _adminPassword = new() { Dock = DockStyle.Fill, UseSystemPasswordChar = true };
        private readonly TextBox _adminToken = new() { Dock = DockStyle.Fill };
        private readonly TextBox _publicUrl = new() { Dock = DockStyle.Fill };
        private readonly CheckBox _autoStart = new() { Text = "开机自动启动服务", Checked = true, AutoSize = true };
        private readonly CheckBox _startAfterInstall = new() { Text = "安装完成后立即启动服务", Checked = true, AutoSize = true };
        private readonly TextBox _log = new() { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Font = new Font("Consolas", 9F) };
        private readonly Button _installButton = new() { Text = "安装服务端", Width = 120, Height = 34 };
        private readonly Button _uninstallButton = new() { Text = "卸载服务", Width = 110, Height = 34 };
        private readonly Button _closeButton = new() { Text = "关闭", Width = 90, Height = 34 };
        private readonly ProgressBar _progress = new() { Dock = DockStyle.Fill, Style = ProgressBarStyle.Blocks };
        private readonly Label _status = new() { Text = "准备安装", AutoSize = true };

        public SetupForm()
        {
            Text = "File Assistant 服务端安装向导";
            Width = 780;
            Height = 680;
            MinimumSize = new Size(720, 620);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9F);

            _installDir.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), DefaultInstallDirName);
            _serviceName.Text = DefaultServiceName;
            _port.Value = 5177;
            _adminUsername.Text = "admin";
            _adminPassword.Text = "";
            _adminToken.Text = CreateSecret();
            _publicUrl.Text = "http://服务器IP:5177";

            Controls.Add(BuildLayout());

            _installButton.Click += async (_, _) => await InstallAsync();
            _uninstallButton.Click += async (_, _) => await UninstallAsync();
            _closeButton.Click += (_, _) => Close();
        }

        private Control BuildLayout()
        {
            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(18),
                ColumnCount = 1,
                RowCount = 5,
            };
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            var title = new Label
            {
                Text = "File Assistant 服务端安装",
                Font = new Font(Font, FontStyle.Bold),
                AutoSize = true,
                Margin = new Padding(0, 0, 0, 6),
            };
            root.Controls.Add(title, 0, 0);

            var description = new Label
            {
                Text = "安装器会写入服务端程序、内置 Node 运行时，并注册 Windows Service。",
                AutoSize = true,
                ForeColor = Color.FromArgb(80, 80, 80),
                Margin = new Padding(0, 0, 0, 14),
            };
            root.Controls.Add(description, 0, 1);

            var content = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                ColumnCount = 3,
                RowCount = 8,
                AutoSize = true,
            };
            content.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
            content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            content.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));

            AddRow(content, 0, "安装目录", _installDir, BrowseButton());
            AddRow(content, 1, "服务名称", _serviceName, null);
            AddRow(content, 2, "服务端口", _port, null);
            AddRow(content, 3, "管理员账号", _adminUsername, null);
            AddRow(content, 4, "管理员密码", _adminPassword, null);
            AddRow(content, 5, "Legacy Token", _adminToken, GenerateTokenButton());
            AddRow(content, 6, "服务地址", _publicUrl, null);

            var checks = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
            checks.Controls.Add(_autoStart);
            checks.Controls.Add(_startAfterInstall);
            content.Controls.Add(new Label { Text = "服务选项", AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 8, 0, 0) }, 0, 7);
            content.Controls.Add(checks, 1, 7);
            content.SetColumnSpan(checks, 2);

            root.Controls.Add(content, 0, 2);

            var logPanel = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, Margin = new Padding(0, 14, 0, 0) };
            logPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            logPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            logPanel.Controls.Add(new Label { Text = "安装日志", AutoSize = true }, 0, 0);
            logPanel.Controls.Add(_log, 0, 1);
            root.Controls.Add(logPanel, 0, 3);

            var footer = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 2, Margin = new Padding(0, 12, 0, 0) };
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            footer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            footer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            footer.Controls.Add(_status, 0, 0);
            footer.Controls.Add(_progress, 0, 1);
            footer.SetColumnSpan(_progress, 3);

            var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight };
            buttons.Controls.Add(_installButton);
            buttons.Controls.Add(_uninstallButton);
            buttons.Controls.Add(_closeButton);
            footer.Controls.Add(buttons, 1, 0);
            footer.SetColumnSpan(buttons, 2);
            root.Controls.Add(footer, 0, 4);

            return root;
        }

        private static void AddRow(TableLayoutPanel panel, int row, string label, Control input, Control? extra)
        {
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            panel.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 8, 0, 0) }, 0, row);
            input.Margin = new Padding(0, 4, 8, 4);
            panel.Controls.Add(input, 1, row);
            if (extra is not null)
            {
                extra.Margin = new Padding(0, 4, 0, 4);
                panel.Controls.Add(extra, 2, row);
            }
        }

        private Button BrowseButton()
        {
            var button = new Button { Text = "浏览", Dock = DockStyle.Fill };
            button.Click += (_, _) =>
            {
                using var dialog = new FolderBrowserDialog { SelectedPath = _installDir.Text, Description = "选择服务端安装目录" };
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    _installDir.Text = dialog.SelectedPath;
                }
            };
            return button;
        }

        private Button GenerateTokenButton()
        {
            var button = new Button { Text = "生成", Dock = DockStyle.Fill };
            button.Click += (_, _) => _adminToken.Text = CreateSecret();
            return button;
        }

        private async Task InstallAsync()
        {
            if (!ValidateInstall())
            {
                return;
            }

            var options = CreateOptions();
            await RunWorkAsync("正在安装服务端...", () => Install(options), "安装完成。");
        }

        private async Task UninstallAsync()
        {
            var confirm = MessageBox.Show(
                this,
                "将停止并删除 Windows 服务，默认保留 data 数据目录。确定继续吗？",
                "确认卸载",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (confirm != DialogResult.Yes)
            {
                return;
            }

            var options = CreateOptions();
            options.Uninstall = true;
            await RunWorkAsync("正在卸载服务...", () => Uninstall(options), "卸载完成，数据目录已保留。");
        }

        private async Task RunWorkAsync(string startMessage, Func<int> work, string doneMessage)
        {
            SetBusy(true, startMessage);
            _log.Clear();
            _logSink = AppendLog;
            try
            {
                await Task.Run(work);
                AppendLog(doneMessage);
                _status.Text = doneMessage;
                MessageBox.Show(this, doneMessage, "File Assistant 服务端安装", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                AppendLog("ERROR: " + ex.Message);
                _status.Text = "操作失败";
                MessageBox.Show(this, ex.Message, "File Assistant 服务端安装", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                _logSink = null;
                SetBusy(false, _status.Text);
            }
        }

        private void SetBusy(bool busy, string message)
        {
            _status.Text = message;
            _progress.Style = busy ? ProgressBarStyle.Marquee : ProgressBarStyle.Blocks;
            _installButton.Enabled = !busy;
            _uninstallButton.Enabled = !busy;
            _closeButton.Enabled = !busy;
        }

        private void AppendLog(string message)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(AppendLog), message);
                return;
            }
            _log.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
        }

        private bool ValidateInstall()
        {
            if (string.IsNullOrWhiteSpace(_installDir.Text))
            {
                MessageBox.Show(this, "请选择安装目录。", "安装参数不完整", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (string.IsNullOrWhiteSpace(_serviceName.Text))
            {
                MessageBox.Show(this, "请输入服务名称。", "安装参数不完整", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (string.IsNullOrWhiteSpace(_adminUsername.Text))
            {
                MessageBox.Show(this, "请输入管理员账号。", "安装参数不完整", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (_adminPassword.Text.Length < 8)
            {
                MessageBox.Show(this, "管理员密码至少需要 8 位。", "安装参数不完整", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (string.IsNullOrWhiteSpace(_adminToken.Text))
            {
                MessageBox.Show(this, "请填写或生成 Legacy Token。", "安装参数不完整", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (!Uri.TryCreate(_publicUrl.Text, UriKind.Absolute, out _))
            {
                MessageBox.Show(this, "服务地址必须是完整 URL，例如 http://服务器IP:5177。", "安装参数不完整", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            return true;
        }

        private SetupOptions CreateOptions()
        {
            return SetupOptions.FromGui(
                installDir: _installDir.Text,
                serviceName: _serviceName.Text,
                port: (int)_port.Value,
                adminUsername: _adminUsername.Text,
                adminPassword: _adminPassword.Text,
                adminToken: _adminToken.Text,
                publicServerUrl: _publicUrl.Text,
                autoStart: _autoStart.Checked,
                startService: _startAfterInstall.Checked);
        }
    }

    private sealed class SetupOptions
    {
        public string InstallDir { get; private set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), DefaultInstallDirName);
        public string ServiceName { get; private set; } = DefaultServiceName;
        public int Port { get; private set; } = 5177;
        public string AdminUsername { get; private set; } = "admin";
        public string AdminPassword { get; private set; } = "change-this-password-before-production";
        public string AdminToken { get; private set; } = "change-this-legacy-token";
        public string PublicServerUrl { get; private set; } = "http://SERVER-IP:5177";
        public int ChunkSizeBytes { get; private set; } = 2097152;
        public bool InstallService { get; private set; } = true;
        public bool AutoStart { get; private set; }
        public bool StartService { get; private set; }
        public bool Uninstall { get; set; }
        public bool RemoveData { get; private set; }
        public bool Help { get; private set; }
        public bool Gui { get; private set; }
        public bool RequiresElevation => !Help && (Uninstall || InstallService || InstallDir.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), StringComparison.OrdinalIgnoreCase));

        public static SetupOptions FromGui(
            string installDir,
            string serviceName,
            int port,
            string adminUsername,
            string adminPassword,
            string adminToken,
            string publicServerUrl,
            bool autoStart,
            bool startService)
        {
            return new SetupOptions
            {
                InstallDir = Path.GetFullPath(installDir),
                ServiceName = serviceName.Trim(),
                Port = port,
                AdminUsername = adminUsername.Trim(),
                AdminPassword = adminPassword,
                AdminToken = adminToken.Trim(),
                PublicServerUrl = publicServerUrl.Trim(),
                AutoStart = autoStart,
                StartService = startService,
                InstallService = true,
            };
        }

        public static SetupOptions Parse(string[] args)
        {
            var options = new SetupOptions { Gui = args.Length == 0 };
            for (var i = 0; i < args.Length; i += 1)
            {
                var arg = args[i];
                switch (arg.ToLowerInvariant())
                {
                    case "--gui":
                        options.Gui = true;
                        break;
                    case "--install-dir":
                        options.InstallDir = RequireValue(args, ref i, arg);
                        break;
                    case "--service-name":
                        options.ServiceName = RequireValue(args, ref i, arg);
                        break;
                    case "--port":
                        options.Port = int.Parse(RequireValue(args, ref i, arg));
                        break;
                    case "--admin-username":
                        options.AdminUsername = RequireValue(args, ref i, arg);
                        break;
                    case "--admin-password":
                        options.AdminPassword = RequireValue(args, ref i, arg);
                        break;
                    case "--admin-token":
                        options.AdminToken = RequireValue(args, ref i, arg);
                        break;
                    case "--public-url":
                        options.PublicServerUrl = RequireValue(args, ref i, arg);
                        break;
                    case "--chunk-size-bytes":
                        options.ChunkSizeBytes = int.Parse(RequireValue(args, ref i, arg));
                        break;
                    case "--no-service":
                        options.InstallService = false;
                        break;
                    case "--auto-start":
                        options.AutoStart = true;
                        break;
                    case "--start":
                        options.StartService = true;
                        break;
                    case "--uninstall":
                        options.Uninstall = true;
                        break;
                    case "--remove-data":
                        options.RemoveData = true;
                        break;
                    case "--help":
                    case "-h":
                    case "/?":
                        options.Help = true;
                        break;
                    default:
                        throw new ArgumentException($"Unknown option: {arg}");
                }
            }

            options.InstallDir = Path.GetFullPath(options.InstallDir);
            return options;
        }

        private static string RequireValue(string[] args, ref int index, string option)
        {
            if (index + 1 >= args.Length)
            {
                throw new ArgumentException($"{option} requires a value.");
            }
            index += 1;
            return args[index];
        }
    }
}

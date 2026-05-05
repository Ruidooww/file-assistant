using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace FileAssistant.ServerService;

internal static class Program
{
    private const int ServiceWin32OwnProcess = 0x00000010;
    private const int ServiceStopped = 0x00000001;
    private const int ServiceStartPending = 0x00000002;
    private const int ServiceStopPending = 0x00000003;
    private const int ServiceRunning = 0x00000004;
    private const int ServiceAcceptStop = 0x00000001;
    private const int ServiceAcceptShutdown = 0x00000004;
    private const int ServiceControlStop = 0x00000001;
    private const int ServiceControlShutdown = 0x00000005;
    private const int NoError = 0;

    private static readonly ManualResetEventSlim StopEvent = new(false);
    private static readonly object SyncRoot = new();
    private static IntPtr _statusHandle;
    private static ServiceStatus _status;
    private static Process? _childProcess;
    private static bool _stopping;
    private static string _serviceName = "FileAssistantServer";
    private static string _baseDir = AppContext.BaseDirectory;
    private static string _logDir = Path.Combine(AppContext.BaseDirectory, "logs");
    private static ServiceMainDelegate? _serviceMainDelegate;
    private static HandlerExDelegate? _handlerDelegate;

    public static int Main(string[] args)
    {
        _serviceName = GetOption(args, "--service-name") ?? Environment.GetEnvironmentVariable("FILE_ASSISTANT_SERVICE_NAME") ?? _serviceName;
        _baseDir = Path.GetFullPath(GetOption(args, "--base-dir") ?? AppContext.BaseDirectory);
        _logDir = Path.GetFullPath(GetOption(args, "--log-dir") ?? Environment.GetEnvironmentVariable("FILE_ASSISTANT_LOG_DIR") ?? Path.Combine(_baseDir, "logs"));

        if (args.Contains("--console", StringComparer.OrdinalIgnoreCase) || Environment.UserInteractive)
        {
            return RunConsole();
        }

        return RunService();
    }

    private static int RunConsole()
    {
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            RequestStop();
        };

        WriteLog("Starting File Assistant server in console mode.");
        StartChildProcess();
        StopEvent.Wait();
        StopChildProcess();
        WriteLog("File Assistant server stopped.");
        return 0;
    }

    private static int RunService()
    {
        _serviceMainDelegate = ServiceMain;
        var serviceTable = new[]
        {
            new ServiceTableEntry { ServiceName = _serviceName, ServiceProc = _serviceMainDelegate },
            new ServiceTableEntry { ServiceName = null, ServiceProc = null },
        };

        if (!StartServiceCtrlDispatcher(serviceTable))
        {
            var error = Marshal.GetLastWin32Error();
            WriteLog($"StartServiceCtrlDispatcher failed: {error}");
            return error;
        }

        return 0;
    }

    private static void ServiceMain(int argc, IntPtr argv)
    {
        _handlerDelegate = ServiceControlHandler;
        _statusHandle = RegisterServiceCtrlHandlerEx(_serviceName, _handlerDelegate, IntPtr.Zero);
        if (_statusHandle == IntPtr.Zero)
        {
            WriteLog($"RegisterServiceCtrlHandlerEx failed: {Marshal.GetLastWin32Error()}");
            return;
        }

        SetServiceStatus(ServiceStartPending, 0, 30000);
        try
        {
            StartChildProcess();
            SetServiceStatus(ServiceRunning, ServiceAcceptStop | ServiceAcceptShutdown, 0);
            StopEvent.Wait();
            SetServiceStatus(ServiceStopPending, 0, 30000);
            StopChildProcess();
            SetServiceStatus(ServiceStopped, 0, 0);
        }
        catch (Exception ex)
        {
            WriteLog("Service failed: " + ex);
            SetServiceStatus(ServiceStopped, 0, 0, 1);
        }
    }

    private static int ServiceControlHandler(int control, int eventType, IntPtr eventData, IntPtr context)
    {
        if (control is ServiceControlStop or ServiceControlShutdown)
        {
            SetServiceStatus(ServiceStopPending, 0, 30000);
            RequestStop();
            return NoError;
        }

        return NoError;
    }

    private static void StartChildProcess()
    {
        Directory.CreateDirectory(_logDir);

        var scriptPath = Path.Combine(_baseDir, "deploy", "server", "start-server.ps1");
        if (!File.Exists(scriptPath))
        {
            throw new FileNotFoundException("Server start script was not found.", scriptPath);
        }

        var powershell = ResolvePowerShell();
        var outLog = Path.Combine(_logDir, "service-wrapper.out.log");
        var errLog = Path.Combine(_logDir, "service-wrapper.err.log");

        var psi = new ProcessStartInfo
        {
            FileName = powershell,
            WorkingDirectory = _baseDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-ExecutionPolicy");
        psi.ArgumentList.Add("Bypass");
        psi.ArgumentList.Add("-File");
        psi.ArgumentList.Add(scriptPath);
        psi.ArgumentList.Add("-Foreground");

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, eventArgs) => AppendLine(outLog, eventArgs.Data);
        process.ErrorDataReceived += (_, eventArgs) => AppendLine(errLog, eventArgs.Data);
        process.Exited += (_, _) =>
        {
            WriteLog($"Child process exited with code {SafeExitCode(process)}.");
            if (!_stopping)
            {
                RequestStop();
            }
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("Failed to start PowerShell host process.");
        }
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        lock (SyncRoot)
        {
            _childProcess = process;
        }

        WriteLog($"Started child process {process.Id}: {powershell} -File {scriptPath} -Foreground");
    }

    private static void StopChildProcess()
    {
        Process? process;
        lock (SyncRoot)
        {
            process = _childProcess;
            _childProcess = null;
            _stopping = true;
        }

        if (process is null)
        {
            return;
        }

        try
        {
            if (!process.HasExited)
            {
                WriteLog($"Stopping child process {process.Id}.");
                process.Kill(entireProcessTree: true);
                process.WaitForExit(15000);
            }
        }
        catch (Exception ex)
        {
            WriteLog("Failed to stop child process: " + ex);
        }
        finally
        {
            process.Dispose();
        }
    }

    private static void RequestStop()
    {
        lock (SyncRoot)
        {
            _stopping = true;
        }
        StopEvent.Set();
    }

    private static string ResolvePowerShell()
    {
        var systemRoot = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var powershell = Path.Combine(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        return File.Exists(powershell) ? powershell : "powershell.exe";
    }

    private static string? GetOption(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i += 1)
        {
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
            {
                return args[i + 1];
            }
        }
        return null;
    }

    private static int SafeExitCode(Process process)
    {
        try
        {
            return process.ExitCode;
        }
        catch
        {
            return -1;
        }
    }

    private static void SetServiceStatus(int state, int controlsAccepted, int waitHint, int win32ExitCode = 0)
    {
        if (_statusHandle == IntPtr.Zero)
        {
            return;
        }

        _status.ServiceType = ServiceWin32OwnProcess;
        _status.CurrentState = state;
        _status.ControlsAccepted = controlsAccepted;
        _status.Win32ExitCode = win32ExitCode;
        _status.ServiceSpecificExitCode = 0;
        _status.CheckPoint = state is ServiceStartPending or ServiceStopPending ? _status.CheckPoint + 1 : 0;
        _status.WaitHint = waitHint;
        SetServiceStatus(_statusHandle, ref _status);
    }

    private static void AppendLine(string path, string? line)
    {
        if (line is null)
        {
            return;
        }
        File.AppendAllText(path, $"[{DateTimeOffset.Now:O}] {line}{Environment.NewLine}", Encoding.UTF8);
    }

    private static void WriteLog(string message)
    {
        try
        {
            Directory.CreateDirectory(_logDir);
            File.AppendAllText(Path.Combine(_logDir, "service-wrapper.log"), $"[{DateTimeOffset.Now:O}] {message}{Environment.NewLine}", Encoding.UTF8);
        }
        catch
        {
            // Service logging must never prevent Windows from stopping the service.
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ServiceTableEntry
    {
        public string? ServiceName;
        public ServiceMainDelegate? ServiceProc;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public int ServiceType;
        public int CurrentState;
        public int ControlsAccepted;
        public int Win32ExitCode;
        public int ServiceSpecificExitCode;
        public int CheckPoint;
        public int WaitHint;
    }

    private delegate void ServiceMainDelegate(int argc, IntPtr argv);

    private delegate int HandlerExDelegate(int control, int eventType, IntPtr eventData, IntPtr context);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool StartServiceCtrlDispatcher([In] ServiceTableEntry[] serviceStartTable);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr RegisterServiceCtrlHandlerEx(string serviceName, HandlerExDelegate handlerProc, IntPtr context);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetServiceStatus(IntPtr serviceStatusHandle, ref ServiceStatus serviceStatus);
}

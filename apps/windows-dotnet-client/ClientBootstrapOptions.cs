using System.Text.Json;

namespace FileAssistant.WinClient;

public sealed class ClientBootstrapOptions
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public string ServerUrl { get; private set; } = "";
    public string RegistrationToken { get; private set; } = "";
    public string TokenKind { get; private set; } = "install-code";
    public string DisplayName { get; private set; } = "";
    public string ReceiveDir { get; private set; } = "";
    public bool AutoRegister { get; private set; }
    public bool MaintenanceMode { get; private set; }

    public static ClientBootstrapOptions Load()
    {
        var options = LoadInstallerBootstrap() ?? new ClientBootstrapOptions();

        ApplyEnvironment(options);
        ApplyCommandLine(options);
        return options;
    }

    private static ClientBootstrapOptions? LoadInstallerBootstrap()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "client-bootstrap.json");
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            var json = File.ReadAllText(path);
            var bootstrap = JsonSerializer.Deserialize<InstallerBootstrapConfig>(json, JsonOptions);
            if (bootstrap is null)
            {
                return null;
            }

            var options = new ClientBootstrapOptions
            {
                ServerUrl = bootstrap.ServerUrl?.Trim() ?? "",
                DisplayName = bootstrap.DisplayName?.Trim() ?? "",
                ReceiveDir = bootstrap.ReceiveDir?.Trim() ?? "",
                AutoRegister = bootstrap.AutoRegister,
                MaintenanceMode = bootstrap.MaintenanceMode
            };

            if (!string.IsNullOrWhiteSpace(bootstrap.DeployToken))
            {
                options.RegistrationToken = bootstrap.DeployToken.Trim();
                options.TokenKind = "deploy-token";
            }
            else if (!string.IsNullOrWhiteSpace(bootstrap.InstallCode))
            {
                options.RegistrationToken = bootstrap.InstallCode.Trim();
                options.TokenKind = "install-code";
            }

            return options;
        }
        catch
        {
            return null;
        }
    }

    private static void ApplyEnvironment(ClientBootstrapOptions options)
    {
        var serverUrl = Environment.GetEnvironmentVariable("FA_SERVER_URL");
        if (!string.IsNullOrWhiteSpace(serverUrl))
        {
            options.ServerUrl = serverUrl;
        }

        var deployToken = Environment.GetEnvironmentVariable("FA_DEPLOY_TOKEN");
        var installCode = Environment.GetEnvironmentVariable("FA_INSTALL_CODE");
        if (!string.IsNullOrWhiteSpace(deployToken))
        {
            options.RegistrationToken = deployToken;
            options.TokenKind = "deploy-token";
        }
        else if (!string.IsNullOrWhiteSpace(installCode))
        {
            options.RegistrationToken = installCode;
            options.TokenKind = "install-code";
        }

        var displayName = Environment.GetEnvironmentVariable("FA_DISPLAY_NAME");
        if (!string.IsNullOrWhiteSpace(displayName))
        {
            options.DisplayName = displayName;
        }

        var receiveDir = Environment.GetEnvironmentVariable("FA_RECEIVE_DIR");
        if (!string.IsNullOrWhiteSpace(receiveDir))
        {
            options.ReceiveDir = receiveDir;
        }

        if (IsTruthy(Environment.GetEnvironmentVariable("FA_AUTO_REGISTER")))
        {
            options.AutoRegister = true;
        }

        if (IsTruthy(Environment.GetEnvironmentVariable("FA_MAINTENANCE_MODE")))
        {
            options.MaintenanceMode = true;
        }
    }

    private static void ApplyCommandLine(ClientBootstrapOptions options)
    {
        var args = Environment.GetCommandLineArgs().Skip(1).ToArray();
        for (var index = 0; index < args.Length; index++)
        {
            var raw = args[index];
            var (name, valueFromSameArg) = SplitArgument(raw);
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var value = valueFromSameArg;
            if (value is null && index + 1 < args.Length && !LooksLikeOption(args[index + 1]))
            {
                value = args[++index];
            }

            switch (NormalizeName(name))
            {
                case "server":
                case "server-url":
                    options.ServerUrl = value ?? "";
                    break;

                case "install-code":
                case "installcode":
                    options.RegistrationToken = value ?? "";
                    options.TokenKind = "install-code";
                    break;

                case "deploy-token":
                case "deploytoken":
                    options.RegistrationToken = value ?? "";
                    options.TokenKind = "deploy-token";
                    break;

                case "display-name":
                case "displayname":
                    options.DisplayName = value ?? "";
                    break;

                case "receive-dir":
                case "receivedir":
                    options.ReceiveDir = value ?? "";
                    break;

                case "auto-register":
                case "autoregister":
                    options.AutoRegister = value is null || IsTruthy(value);
                    break;

                case "maintenance":
                case "maintenance-mode":
                case "maintenancemode":
                    options.MaintenanceMode = value is null || IsTruthy(value);
                    break;
            }
        }
    }

    private static (string Name, string? Value) SplitArgument(string arg)
    {
        if (!LooksLikeOption(arg))
        {
            return ("", null);
        }

        var trimmed = arg.TrimStart('-', '/');
        var separator = trimmed.IndexOfAny(new[] { '=', ':' });
        if (separator < 0)
        {
            return (trimmed, null);
        }

        return (trimmed[..separator], trimmed[(separator + 1)..]);
    }

    private static bool LooksLikeOption(string value)
    {
        return value.StartsWith("--", StringComparison.Ordinal)
            || value.StartsWith("/", StringComparison.Ordinal);
    }

    private static string NormalizeName(string value)
    {
        return value.Trim().ToLowerInvariant();
    }

    private static bool IsTruthy(string? value)
    {
        return string.Equals(value, "1", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "yes", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "y", StringComparison.OrdinalIgnoreCase);
    }

    private sealed class InstallerBootstrapConfig
    {
        public string? ServerUrl { get; set; }
        public string? DeployToken { get; set; }
        public string? InstallCode { get; set; }
        public string? DisplayName { get; set; }
        public string? ReceiveDir { get; set; }
        public bool AutoRegister { get; set; }
        public bool MaintenanceMode { get; set; }
    }
}

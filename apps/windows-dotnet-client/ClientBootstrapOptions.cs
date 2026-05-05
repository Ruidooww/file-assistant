namespace FileAssistant.WinClient;

public sealed class ClientBootstrapOptions
{
    public string ServerUrl { get; private set; } = "";
    public string RegistrationToken { get; private set; } = "";
    public string TokenKind { get; private set; } = "install-code";
    public string DisplayName { get; private set; } = "";
    public string ReceiveDir { get; private set; } = "";
    public bool AutoRegister { get; private set; }
    public bool MaintenanceMode { get; private set; }

    public static ClientBootstrapOptions Load()
    {
        var options = new ClientBootstrapOptions
        {
            ServerUrl = Environment.GetEnvironmentVariable("FA_SERVER_URL") ?? "",
            RegistrationToken = Environment.GetEnvironmentVariable("FA_DEPLOY_TOKEN")
                ?? Environment.GetEnvironmentVariable("FA_INSTALL_CODE")
                ?? "",
            DisplayName = Environment.GetEnvironmentVariable("FA_DISPLAY_NAME") ?? "",
            ReceiveDir = Environment.GetEnvironmentVariable("FA_RECEIVE_DIR") ?? "",
            AutoRegister = IsTruthy(Environment.GetEnvironmentVariable("FA_AUTO_REGISTER")),
            MaintenanceMode = IsTruthy(Environment.GetEnvironmentVariable("FA_MAINTENANCE_MODE"))
        };

        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("FA_DEPLOY_TOKEN")))
        {
            options.TokenKind = "deploy-token";
        }

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

        return options;
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
}

using System.Text.Json;
using System.Text.Json.Serialization;

namespace FileAssistant.WinClient;

public sealed class ClientConfig
{
    [JsonPropertyName("serverUrl")]
    public string ServerUrl { get; set; } = "http://localhost:5177";

    [JsonPropertyName("clientId")]
    public string ClientId { get; set; } = "";

    [JsonPropertyName("clientSecret")]
    public string ClientSecret { get; set; } = "";

    [JsonPropertyName("macAddress")]
    public string MacAddress { get; set; } = "";

    [JsonPropertyName("ipAddress")]
    public string IpAddress { get; set; } = "";

    [JsonPropertyName("displayName")]
    public string DisplayName { get; set; } = $"{Environment.MachineName}\\{Environment.UserName}";

    [JsonPropertyName("receiveDir")]
    public string ReceiveDir { get; set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        "Downloads",
        "FileAssistant");

    [JsonIgnore]
    public bool HasCredentials => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}

public static class ClientConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static string ConfigDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FileAssistant");

    public static string ConfigPath => Path.Combine(ConfigDirectory, "client.json");

    public static string LogDirectory => Path.Combine(ConfigDirectory, "logs");

    public static string LogPath => Path.Combine(LogDirectory, "client.log");

    public static ClientConfig Load()
    {
        var defaults = new ClientConfig();
        var device = DeviceInfo.Detect();
        defaults.MacAddress = device.MacAddress;
        defaults.IpAddress = device.IpAddress;

        if (!File.Exists(ConfigPath))
        {
            return defaults;
        }

        try
        {
            var json = File.ReadAllText(ConfigPath);
            var saved = JsonSerializer.Deserialize<ClientConfig>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            if (saved is null)
            {
                return defaults;
            }

            saved.ServerUrl = string.IsNullOrWhiteSpace(saved.ServerUrl) ? defaults.ServerUrl : saved.ServerUrl;
            saved.DisplayName = string.IsNullOrWhiteSpace(saved.DisplayName) ? defaults.DisplayName : saved.DisplayName;
            saved.MacAddress = string.IsNullOrWhiteSpace(saved.MacAddress) ? defaults.MacAddress : saved.MacAddress;
            saved.IpAddress = string.IsNullOrWhiteSpace(saved.IpAddress) ? defaults.IpAddress : saved.IpAddress;
            saved.ReceiveDir = string.IsNullOrWhiteSpace(saved.ReceiveDir) ? defaults.ReceiveDir : saved.ReceiveDir;
            return saved;
        }
        catch
        {
            return defaults;
        }
    }

    public static void Save(ClientConfig config)
    {
        Directory.CreateDirectory(ConfigDirectory);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(config, JsonOptions));
    }

    public static void AppendLog(string line)
    {
        try
        {
            Directory.CreateDirectory(LogDirectory);
            File.AppendAllText(LogPath, line + Environment.NewLine);
        }
        catch
        {
        }
    }
}

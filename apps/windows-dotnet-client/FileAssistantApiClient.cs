using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FileAssistant.WinClient;

public sealed class FileAssistantApiClient : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromMinutes(60)
    };

    private ClientConfig _config;

    public FileAssistantApiClient(ClientConfig config)
    {
        _config = config;
    }

    public void UpdateConfig(ClientConfig config)
    {
        _config = config;
    }

    public Task<HealthResponse?> GetHealthAsync(CancellationToken cancellationToken = default)
    {
        return SendJsonAsync<HealthResponse>(HttpMethod.Get, "/api/health", null, false, cancellationToken);
    }

    public Task<RegisterClientResponse?> RegisterClientAsync(RegisterClientRequest request, CancellationToken cancellationToken = default)
    {
        return SendJsonAsync<RegisterClientResponse>(HttpMethod.Post, "/api/client/register", request, false, cancellationToken);
    }

    public Task<RegisterClientResponse?> AutoRegisterClientAsync(RegisterClientRequest request, CancellationToken cancellationToken = default)
    {
        return SendJsonAsync<RegisterClientResponse>(HttpMethod.Post, "/api/client/auto-register", request, false, cancellationToken);
    }

    public Task<RegisterClientResponse?> OpenRegisterClientAsync(RegisterClientRequest request, CancellationToken cancellationToken = default)
    {
        return SendJsonAsync<RegisterClientResponse>(HttpMethod.Post, "/api/client/open-register", request, false, cancellationToken);
    }

    public Task<ClientDto?> GetMeAsync(CancellationToken cancellationToken = default)
    {
        return SendJsonAsync<ClientDto>(HttpMethod.Get, "/api/client/me", null, true, cancellationToken);
    }

    public async Task<IReadOnlyList<RecipientDto>> GetRecipientsAsync(CancellationToken cancellationToken = default)
    {
        var recipients = await SendJsonAsync<List<RecipientDto>>(HttpMethod.Get, "/api/client/recipients", null, true, cancellationToken);
        return recipients ?? [];
    }

    public async Task<IReadOnlyList<TransferDto>> GetTransfersAsync(CancellationToken cancellationToken = default)
    {
        var transfers = await SendJsonAsync<List<TransferDto>>(HttpMethod.Get, "/api/client/transfers", null, true, cancellationToken);
        return transfers ?? [];
    }

    public Task<InitTransferResponse?> InitTransferAsync(InitTransferRequest request, CancellationToken cancellationToken = default)
    {
        return SendJsonAsync<InitTransferResponse>(HttpMethod.Post, "/api/client/transfers/init", request, true, cancellationToken);
    }

    public async Task<TransferDto?> UploadChunkAsync(string transferId, int chunkIndex, byte[] bytes, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, BuildUri($"/api/client/transfers/{Uri.EscapeDataString(transferId)}/chunks/{chunkIndex}"));
        AddClientHeaders(request);
        request.Content = new ByteArrayContent(bytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");

        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var envelope = await JsonSerializer.DeserializeAsync<TransferEnvelope>(stream, JsonOptions, cancellationToken);
        return envelope?.Transfer;
    }

    public async Task DownloadTransferFileAsync(string transferId, string destinationPath, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, BuildUri($"/api/client/transfers/{Uri.EscapeDataString(transferId)}/file?mode=receive"));
        AddClientHeaders(request);

        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);

        await using var responseStream = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var fileStream = new FileStream(destinationPath, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024, true);
        await responseStream.CopyToAsync(fileStream, cancellationToken);
    }

    public Task<TransferDto?> ConfirmDeliveryAsync(string transferId, string localPath, CancellationToken cancellationToken = default)
    {
        return SendJsonAsync<TransferDto>(
            HttpMethod.Post,
            $"/api/client/transfers/{Uri.EscapeDataString(transferId)}/confirm-delivery",
            new { localPath },
            true,
            cancellationToken);
    }

    private async Task<T?> SendJsonAsync<T>(
        HttpMethod method,
        string path,
        object? body,
        bool authenticated,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, BuildUri(path));
        if (authenticated)
        {
            AddClientHeaders(request);
        }

        if (body is not null)
        {
            var json = JsonSerializer.Serialize(body, JsonOptions);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        return await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken);
    }

    private Uri BuildUri(string path)
    {
        var baseUrl = string.IsNullOrWhiteSpace(_config.ServerUrl) ? "http://localhost:5177" : _config.ServerUrl.Trim();
        baseUrl = baseUrl.TrimEnd('/');
        var relative = path.StartsWith('/') ? path : "/" + path;
        return new Uri(baseUrl + relative, UriKind.Absolute);
    }

    private void AddClientHeaders(HttpRequestMessage request)
    {
        request.Headers.TryAddWithoutValidation("X-Client-Id", _config.ClientId);
        request.Headers.TryAddWithoutValidation("X-Client-Secret", _config.ClientSecret);
        request.Headers.TryAddWithoutValidation("X-Device-Mac", _config.MacAddress);
        request.Headers.TryAddWithoutValidation("X-Device-Ip", _config.IpAddress);
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var raw = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(raw))
        {
            try
            {
                var error = JsonSerializer.Deserialize<ErrorResponse>(raw, JsonOptions);
                if (!string.IsNullOrWhiteSpace(error?.Error))
                {
                    throw new InvalidOperationException(error.Error);
                }
            }
            catch (JsonException)
            {
            }
        }

        throw new InvalidOperationException($"HTTP {(int)response.StatusCode} {response.ReasonPhrase}");
    }

    public void Dispose()
    {
        _httpClient.Dispose();
    }
}

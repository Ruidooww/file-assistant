using System.Text.Json.Serialization;

namespace FileAssistant.WinClient;

public sealed class HealthResponse
{
    public bool Ok { get; set; }
    public string At { get; set; } = "";
}

public sealed class RegisterClientRequest
{
    public string InstallCode { get; set; } = "";
    public string DeployToken { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string MacAddress { get; set; } = "";
    public string IpAddress { get; set; } = "";
    public string Platform { get; set; } = "";
}

public sealed class RegisterClientResponse
{
    public ClientDto? Client { get; set; }
    public string ClientSecret { get; set; } = "";
}

public sealed class ClientDto
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string MacAddress { get; set; } = "";
    public string IpAddress { get; set; } = "";
    public string Platform { get; set; } = "";
    public string EmployeeId { get; set; } = "";
    public string EmployeeName { get; set; } = "";
    public string EmployeeNo { get; set; } = "";
    public string EmployeeTitle { get; set; } = "";
    public string DepartmentName { get; set; } = "";
    public string Status { get; set; } = "";
}

public sealed class RecipientDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string DepartmentName { get; set; } = "";
    public int ClientCount { get; set; }

    public override string ToString()
    {
        var suffix = string.IsNullOrWhiteSpace(DepartmentName) ? "" : $" - {DepartmentName}";
        return $"{Name}{suffix} ({ClientCount} devices)";
    }
}

public sealed class TransferDto
{
    public string Id { get; set; } = "";
    public string SenderId { get; set; } = "";
    public string SenderName { get; set; } = "";
    public string SenderEmployeeName { get; set; } = "";
    public string ReceiverId { get; set; } = "";
    public string ReceiverName { get; set; } = "";
    public string ReceiverEmployeeId { get; set; } = "";
    public string ReceiverEmployeeName { get; set; } = "";
    public string FileName { get; set; } = "";
    public long Size { get; set; }
    public int ChunkSize { get; set; }
    public int TotalChunks { get; set; }
    public int Progress { get; set; }
    public string Status { get; set; } = "";
    public string DeliveryStatus { get; set; } = "";
    public string ServerFileStatus { get; set; } = "";
    public bool RetainOnServer { get; set; }
    public TransferControlsDto? Controls { get; set; }
}

public sealed class TransferControlsDto
{
    public ReceiverControlsDto? Receiver { get; set; }
}

public sealed class ReceiverControlsDto
{
    public bool AllowReceive { get; set; } = true;
    public bool AllowPreview { get; set; }
    public bool AllowScreenshot { get; set; } = true;
}

public sealed class InitTransferRequest
{
    public string ReceiverEmployeeId { get; set; } = "";
    public string FileName { get; set; } = "";
    public string MimeType { get; set; } = "application/octet-stream";
    public long Size { get; set; }
    public bool RetainOnServer { get; set; }
    public string UploadNote { get; set; } = "";
    public TransferControlsRequest Controls { get; set; } = new();
}

public sealed class TransferControlsRequest
{
    public UploaderControlsRequest Uploader { get; set; } = new();
    public ReceiverControlsRequest Receiver { get; set; } = new();
}

public sealed class UploaderControlsRequest
{
    public bool AllowStatusView { get; set; } = true;
}

public sealed class ReceiverControlsRequest
{
    public bool AllowReceive { get; set; } = true;
    public bool AllowPreview { get; set; }
    public bool AllowScreenshot { get; set; } = true;
}

public sealed class InitTransferResponse
{
    public TransferDto? Transfer { get; set; }
    public int ChunkSize { get; set; }
    public int[] MissingChunks { get; set; } = [];
}

public sealed class TransferEnvelope
{
    public TransferDto? Transfer { get; set; }
}

public sealed class ErrorResponse
{
    [JsonPropertyName("error")]
    public string Error { get; set; } = "";
}

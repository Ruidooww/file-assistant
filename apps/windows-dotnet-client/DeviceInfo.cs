using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace FileAssistant.WinClient;

public sealed record DeviceSnapshot(
    string MachineName,
    string UserName,
    string MacAddress,
    string IpAddress,
    string Platform);

public static class DeviceInfo
{
    public static DeviceSnapshot Detect()
    {
        var adapter = NetworkInterface.GetAllNetworkInterfaces()
            .Where(item => item.OperationalStatus == OperationalStatus.Up)
            .Where(item => item.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .Where(item => item.GetPhysicalAddress().GetAddressBytes().Length > 0)
            .OrderByDescending(item => item.Speed)
            .FirstOrDefault();

        var mac = adapter is null
            ? ""
            : string.Join(":", adapter.GetPhysicalAddress().GetAddressBytes().Select(item => item.ToString("X2")));

        var ip = adapter?.GetIPProperties()
            .UnicastAddresses
            .Where(item => item.Address.AddressFamily == AddressFamily.InterNetwork)
            .Select(item => item.Address)
            .FirstOrDefault(IsUsableIpAddress)
            ?.ToString() ?? "";

        if (string.IsNullOrWhiteSpace(ip))
        {
            ip = Dns.GetHostEntry(Dns.GetHostName())
                .AddressList
                .Where(item => item.AddressFamily == AddressFamily.InterNetwork)
                .FirstOrDefault(IsUsableIpAddress)
                ?.ToString() ?? "";
        }

        return new DeviceSnapshot(
            Environment.MachineName,
            Environment.UserName,
            mac,
            ip,
            $"{RuntimeInformation.OSDescription} {RuntimeInformation.OSArchitecture}");
    }

    private static bool IsUsableIpAddress(IPAddress address)
    {
        if (IPAddress.IsLoopback(address))
        {
            return false;
        }

        var text = address.ToString();
        return !text.StartsWith("169.254.", StringComparison.Ordinal);
    }
}

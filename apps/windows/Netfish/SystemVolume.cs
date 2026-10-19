using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Netfish;

/// <summary>
/// Windows' own volume, the one the volume keys and the taskbar change: the player's slider
/// follows it and sets it, and mpv plays at full volume. It follows the default output
/// (headphones plugged in, another device chosen…). Used from the window's thread only;
/// <see cref="Changed"/> comes from Windows' audio thread (true: the output itself changed).
/// </summary>
sealed class SystemVolume : IDisposable
{
    public event Action<bool>? Changed;

    readonly IMMDeviceEnumerator? devices;
    readonly VolumeCallback volumeCallback;
    readonly DeviceCallback deviceCallback;
    IAudioEndpointVolume? endpoint;

    public SystemVolume()
    {
        volumeCallback = new VolumeCallback(this);
        deviceCallback = new DeviceCallback(this);
        try
        {
            devices = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            devices.RegisterEndpointNotificationCallback(deviceCallback);
        }
        catch (Exception) { devices = null; } // no audio service
        Follow();
    }

    /// <summary>Listens to the default output's volume (and no longer to the last one's).</summary>
    public void Follow()
    {
        Release();
        if (devices == null || devices.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out var device) != 0 || device == null) return;
        try
        {
            var iid = typeof(IAudioEndpointVolume).GUID;
            device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out var activated);
            endpoint = (IAudioEndpointVolume)activated;
            endpoint.RegisterControlChangeNotify(volumeCallback);
        }
        catch (Exception) { endpoint = null; }
        finally { Marshal.ReleaseComObject(device); }
    }

    void Release()
    {
        if (endpoint == null) return;
        try { endpoint.UnregisterControlChangeNotify(volumeCallback); } catch (Exception) { }
        Marshal.ReleaseComObject(endpoint);
        endpoint = null;
    }

    /// <summary>For the page: <c>available</c>, and the volume (0 to 1) and mute when it is.</summary>
    public JsonObject Json()
    {
        try
        {
            if (endpoint != null)
            {
                endpoint.GetMasterVolumeLevelScalar(out var level);
                endpoint.GetMute(out var muted);
                return new JsonObject { ["available"] = true, ["volume"] = Math.Round(level, 4), ["muted"] = muted };
            }
        }
        catch (Exception) { }
        return new JsonObject { ["available"] = false };
    }

    public void SetVolume(double volume)
    {
        var context = Guid.Empty;
        try { endpoint?.SetMasterVolumeLevelScalar((float)Math.Clamp(volume, 0, 1), ref context); } catch (Exception) { }
    }

    public void SetMuted(bool muted)
    {
        var context = Guid.Empty;
        try { endpoint?.SetMute(muted, ref context); } catch (Exception) { }
    }

    public void Dispose()
    {
        Release();
        if (devices == null) return;
        try { devices.UnregisterEndpointNotificationCallback(deviceCallback); } catch (Exception) { }
        Marshal.ReleaseComObject(devices);
    }

    // ---------- Windows' Core Audio (mmdeviceapi.h, endpointvolume.h) ----------

    const int CLSCTX_ALL = 0x17;

    enum EDataFlow { Render = 0, Capture = 1, All = 2 }
    enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey
    {
        public Guid FormatId;
        public int PropertyId;
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        void EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice? endpoint);
        void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        void RegisterEndpointNotificationCallback(IMMNotificationClient client);
        void UnregisterEndpointNotificationCallback(IMMNotificationClient client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        void Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object activated);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        void RegisterControlChangeNotify(IAudioEndpointVolumeCallback notify);
        void UnregisterControlChangeNotify(IAudioEndpointVolumeCallback notify);
        void GetChannelCount(out uint count);
        void SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
        void SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
        void GetMasterVolumeLevel(out float levelDb);
        void GetMasterVolumeLevelScalar(out float level);
        void SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
        void SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
        void GetChannelVolumeLevel(uint channel, out float levelDb);
        void GetChannelVolumeLevelScalar(uint channel, out float level);
        void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [ComImport, Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolumeCallback
    {
        [PreserveSig] int OnNotify(IntPtr data);
    }

    [ComImport, Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMNotificationClient
    {
        [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int newState);
        [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
        [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
        [PreserveSig] int OnDefaultDeviceChanged(EDataFlow flow, ERole role, [MarshalAs(UnmanagedType.LPWStr)] string? defaultDeviceId);
        [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, PropertyKey key);
    }

    /// <summary>The volume or mute changed (from anywhere: the keys, the taskbar, this app).</summary>
    sealed class VolumeCallback(SystemVolume owner) : IAudioEndpointVolumeCallback
    {
        public int OnNotify(IntPtr data)
        {
            owner.Changed?.Invoke(false);
            return 0;
        }
    }

    /// <summary>Another output became the default one.</summary>
    sealed class DeviceCallback(SystemVolume owner) : IMMNotificationClient
    {
        public int OnDeviceStateChanged(string deviceId, int newState) => 0;
        public int OnDeviceAdded(string deviceId) => 0;
        public int OnDeviceRemoved(string deviceId) => 0;
        public int OnDefaultDeviceChanged(EDataFlow flow, ERole role, string? defaultDeviceId)
        {
            if (flow == EDataFlow.Render && role == ERole.Multimedia) owner.Changed?.Invoke(true);
            return 0;
        }
        public int OnPropertyValueChanged(string deviceId, PropertyKey key) => 0;
    }
}

using System;
using System.Runtime.InteropServices;
using System.Threading;

static class PetOcclusion
{
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    const int DWMWA_CLOAKED = 14;

    static IntPtr target;
    static RECT targetRect;
    static uint myPid;
    static IntPtr occluder;
    static bool reachedTarget;
    static bool debug = Environment.GetEnvironmentVariable("PET_OCCL_DEBUG") == "1";

    static bool Callback(IntPtr h, IntPtr lp)
    {
        if (h == target) { reachedTarget = true; return false; }
        if (!IsWindowVisible(h)) return true;
        int cloaked;
        if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid == myPid) return true;
        RECT r;
        if (!GetWindowRect(h, out r)) return true;
        if (debug) Console.Error.WriteLine("win " + h + " pid " + pid + " rect " + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom);
        long w = r.Right - r.Left, hh = r.Bottom - r.Top;
        if (w < 12 || hh < 12) return true;
        long ix = Math.Min(r.Right, targetRect.Right) - Math.Max(r.Left, targetRect.Left);
        long iy = Math.Min(r.Bottom, targetRect.Bottom) - Math.Max(r.Top, targetRect.Top);
        if (ix <= 0 || iy <= 0) return true;
        long area = (long)(targetRect.Right - targetRect.Left) * (long)(targetRect.Bottom - targetRect.Top);
        if (area <= 0) return true;
        if (debug) Console.Error.WriteLine("intersect " + (ix * iy) + " / " + area);
        if (ix * iy * 100 / area >= 10) { occluder = h; return false; }
        return true;
    }

    static bool IsOccluded()
    {
        if (!GetWindowRect(target, out targetRect)) return false;
        occluder = IntPtr.Zero;
        reachedTarget = false;
        EnumWindows(Callback, IntPtr.Zero);
        if (debug) Console.Error.WriteLine("target rect " + targetRect.Left + "," + targetRect.Top + "," + targetRect.Right + "," + targetRect.Bottom + " reached=" + reachedTarget + " occ=" + occluder);
        // Any hit above the target in the z-order (EnumWindows is top-first) is an occluder.
        return occluder != IntPtr.Zero;
    }

    static int Main(string[] args)
    {
        if (args.Length < 1) return 2;
        long raw;
        if (!long.TryParse(args[0], out raw) || raw == 0) return 2;
        target = new IntPtr(raw);
        myPid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        int? last = null;
        for (int i = 0; i < 100000; i++)
        {
            RECT probe;
            if (!GetWindowRect(target, out probe)) return 0;
            bool occ = IsOccluded();
            int v = occ ? 1 : 0;
            if (last != v) { last = v; Console.WriteLine(occ ? "OCCLUDED" : "VISIBLE"); Console.Out.Flush(); }
            Thread.Sleep(120);
        }
        return 0;
    }
}

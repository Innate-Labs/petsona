// 系统权限探测：辅助功能 / 屏幕录制（SYS_PERMISSION_STATE 数据源）

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

pub fn accessibility() -> bool {
    unsafe { AXIsProcessTrusted() }
}

pub fn screen_recording() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

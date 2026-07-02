// 空闲检测：CGEventSourceSecondsSinceLastEventType（HID 全事件）

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: u32, event_type: u32) -> f64;
}

const HID_SYSTEM_STATE: u32 = 1;          // kCGEventSourceStateHIDSystemState
const ANY_INPUT_EVENT: u32 = u32::MAX;    // kCGAnyInputEventType

pub fn idle_minutes() -> u64 {
    let secs = unsafe { CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, ANY_INPUT_EVENT) };
    (secs / 60.0) as u64
}

/// SPEC-GAP: M1 全屏检测简化返回 false（可靠实现需 CGWindowList 遍历，随 M3 fullscreenMute 一起做）
pub fn frontmost_fullscreen() -> bool {
    false
}

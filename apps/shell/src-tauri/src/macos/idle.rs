// 空闲检测：CGEventSourceSecondsSinceLastEventType（HID 全事件）
// 全屏检测：CGWindowList 首个 layer-0 在屏窗口的 bounds 覆盖任一显示器即视为全屏。
// 为什么用 CGWindowList：不需要屏幕录制权限（只读 bounds/layer，不读窗口名）；
// 自家桌宠是高 layer 的 NSPanel，天然被 layer==0 过滤，不会误判自己。

use std::ffi::c_void;

type CFArrayRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFStringRef = *const c_void;
type CFNumberRef = *const c_void;
type CFIndex = isize;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: u32, event_type: u32) -> f64;
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFArrayRef;
    fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> bool;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> CGRect;
    static kCGWindowLayer: CFStringRef;
    static kCGWindowBounds: CFStringRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(arr: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(arr: CFArrayRef, idx: CFIndex) -> *const c_void;
    fn CFDictionaryGetValue(dict: CFDictionaryRef, key: *const c_void) -> *const c_void;
    fn CFNumberGetValue(num: CFNumberRef, the_type: CFIndex, out: *mut c_void) -> bool;
    fn CFRelease(cf: *const c_void);
}

const HID_SYSTEM_STATE: u32 = 1; // kCGEventSourceStateHIDSystemState
const ANY_INPUT_EVENT: u32 = u32::MAX; // kCGAnyInputEventType
const OPT_ON_SCREEN_ONLY: u32 = 1 << 0; // kCGWindowListOptionOnScreenOnly
const OPT_EXCLUDE_DESKTOP: u32 = 1 << 4; // kCGWindowListExcludeDesktopElements
const NULL_WINDOW_ID: u32 = 0; // kCGNullWindowID
const CF_NUMBER_INT_TYPE: CFIndex = 9; // kCFNumberIntType

pub fn idle_minutes() -> u64 {
    let secs = unsafe { CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, ANY_INPUT_EVENT) };
    (secs / 60.0) as u64
}

pub fn frontmost_fullscreen() -> bool {
    unsafe {
        let arr = CGWindowListCopyWindowInfo(OPT_ON_SCREEN_ONLY | OPT_EXCLUDE_DESKTOP, NULL_WINDOW_ID);
        if arr.is_null() {
            return false;
        }
        let mut result = false;
        let n = CFArrayGetCount(arr);
        for i in 0..n {
            let dict = CFArrayGetValueAtIndex(arr, i) as CFDictionaryRef;
            if dict.is_null() {
                continue;
            }
            let layer_ref = CFDictionaryGetValue(dict, kCGWindowLayer as *const c_void) as CFNumberRef;
            if layer_ref.is_null() {
                continue;
            }
            let mut layer: i32 = -1;
            if !CFNumberGetValue(layer_ref, CF_NUMBER_INT_TYPE, &mut layer as *mut i32 as *mut c_void) {
                continue;
            }
            if layer != 0 {
                continue; // 菜单栏/Dock/浮窗等非普通层，跳过
            }
            // 数组前到后 = 窗口前到后：首个 layer-0 即前台普通窗口
            let bounds_ref = CFDictionaryGetValue(dict, kCGWindowBounds as *const c_void) as CFDictionaryRef;
            if !bounds_ref.is_null() {
                let mut rect = CGRect::default();
                if CGRectMakeWithDictionaryRepresentation(bounds_ref, &mut rect) {
                    result = covers_any_display(&rect);
                }
            }
            break;
        }
        CFRelease(arr);
        result
    }
}

fn covers_any_display(w: &CGRect) -> bool {
    unsafe {
        let mut ids = [0u32; 8];
        let mut count: u32 = 0;
        if CGGetActiveDisplayList(8, ids.as_mut_ptr(), &mut count) != 0 {
            return false;
        }
        (0..count as usize).any(|i| {
            let d = CGDisplayBounds(ids[i]);
            w.origin.x <= d.origin.x
                && w.origin.y <= d.origin.y
                && w.origin.x + w.size.width >= d.origin.x + d.size.width
                && w.origin.y + w.size.height >= d.origin.y + d.size.height
        })
    }
}

/**
 * electron-trackpad-detect
 *
 * Native addon for detecting trackpad vs mouse wheel scroll on macOS.
 * Uses NSEvent's hasPreciseScrollingDeltas property which is the authoritative
 * signal for distinguishing continuous (trackpad) from discrete (mouse wheel) scrolling.
 *
 * Electron's MouseWheelInputEvent.hasPreciseScrollingDeltas is documented but always
 * returns undefined - this addon fills that gap.
 */

#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <napi.h>
#include <atomic>

namespace {

// Thread-safe storage for last scroll event's trackpad status
std::atomic<bool> g_lastScrollWasTrackpad{false};

// Monitor handle for cleanup
id g_scrollMonitor = nil;

// Whether monitoring is active
std::atomic<bool> g_isMonitoring{false};

/**
 * Start monitoring scroll wheel events.
 * Must be called from the main thread (Electron main process).
 */
Napi::Value StartMonitoring(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_isMonitoring.load()) {
        return Napi::Boolean::New(env, true);
    }

    // Monitor scroll wheel events using NSEvent local monitor
    // This runs on the main thread, synchronized with Electron's event loop
    NSEventMask mask = NSEventMaskScrollWheel;

    g_scrollMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask
                                                            handler:^NSEvent*(NSEvent* event) {
        // hasPreciseScrollingDeltas is the authoritative signal:
        // - true: continuous scrolling device (trackpad, Magic Mouse)
        // - false: discrete scrolling device (traditional scroll wheel)
        BOOL isTrackpad = [event hasPreciseScrollingDeltas];
        g_lastScrollWasTrackpad.store(isTrackpad);

        // Return the event unchanged (we're just observing)
        return event;
    }];

    if (g_scrollMonitor) {
        g_isMonitoring.store(true);
        return Napi::Boolean::New(env, true);
    } else {
        return Napi::Boolean::New(env, false);
    }
}

/**
 * Stop monitoring scroll wheel events.
 */
Napi::Value StopMonitoring(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_scrollMonitor) {
        [NSEvent removeMonitor:g_scrollMonitor];
        g_scrollMonitor = nil;
        g_isMonitoring.store(false);
    }

    return env.Undefined();
}

/**
 * Get whether the last scroll event was from a trackpad.
 * Returns true for trackpad/Magic Mouse, false for traditional mouse wheel.
 */
Napi::Value IsTrackpadScroll(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, g_lastScrollWasTrackpad.load());
}

/**
 * Check if monitoring is currently active.
 */
Napi::Value IsMonitoring(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, g_isMonitoring.load());
}

/**
 * Initialize the module exports.
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("startMonitoring", Napi::Function::New(env, StartMonitoring));
    exports.Set("stopMonitoring", Napi::Function::New(env, StopMonitoring));
    exports.Set("isTrackpadScroll", Napi::Function::New(env, IsTrackpadScroll));
    exports.Set("isMonitoring", Napi::Function::New(env, IsMonitoring));
    return exports;
}

} // anonymous namespace

NODE_API_MODULE(trackpad_detect, Init)

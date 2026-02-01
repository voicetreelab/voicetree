/**
 * Stub implementation for non-macOS platforms.
 * Returns no-op functions since native trackpad detection is macOS-only.
 */

#include <napi.h>

namespace {

Napi::Value StartMonitoring(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value StopMonitoring(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value IsTrackpadScroll(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value IsMonitoring(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("startMonitoring", Napi::Function::New(env, StartMonitoring));
    exports.Set("stopMonitoring", Napi::Function::New(env, StopMonitoring));
    exports.Set("isTrackpadScroll", Napi::Function::New(env, IsTrackpadScroll));
    exports.Set("isMonitoring", Napi::Function::New(env, IsMonitoring));
    return exports;
}

} // anonymous namespace

NODE_API_MODULE(trackpad_detect, Init)

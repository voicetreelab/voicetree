{
  "targets": [
    {
      "target_name": "trackpad_detect",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS==\"mac\"",
          {
            "sources": ["src/addon.mm"],
            "xcode_settings": {
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "MACOSX_DEPLOYMENT_TARGET": "10.15",
              "OTHER_LDFLAGS": [
                "-framework Foundation",
                "-framework AppKit",
                "-framework ApplicationServices"
              ]
            }
          }
        ],
        [
          "OS!=\"mac\"",
          {
            "sources": ["src/stub.cc"]
          }
        ]
      ]
    }
  ]
}

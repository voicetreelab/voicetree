/* @ts-self-types="./pivotmds_wasm.d.ts" */
import * as wasm from "./pivotmds_wasm_bg.wasm";
import { __wbg_set_wasm } from "./pivotmds_wasm_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    runPivotMdsWasmProjection
} from "./pivotmds_wasm_bg.js";

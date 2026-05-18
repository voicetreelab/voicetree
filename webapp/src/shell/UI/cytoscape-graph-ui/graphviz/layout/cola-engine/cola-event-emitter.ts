// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyColaEventEmitter(ColaLayout: any): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ColaLayout.prototype.on = function(event: any, callback: any){
        this._listeners[event] ??= [];
        this._listeners[event].push(callback);
        return this;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ColaLayout.prototype.one = function(event: any, callback: any){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wrapper: (...args: any[]) => void = (...args: any[]) => {
            callback(...args);
            this.off(event, wrapper);
        };
        this.on(event, wrapper);
        return this;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ColaLayout.prototype.off = function(event: any, callback: any){
        if (this._listeners[event]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this._listeners[event] = this._listeners[event].filter((cb: any) => cb !== callback);
        }
        return this;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ColaLayout.prototype.trigger = function(data: any){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const event: any = data.type ?? data;
        if (this._listeners[event]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this._listeners[event].forEach((callback: any) => callback(data));
        }
        return this;
    };
}

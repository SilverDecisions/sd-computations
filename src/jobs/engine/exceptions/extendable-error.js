export class ExtendableError extends Error {
    data;
    constructor(message, data) {
        super(message);
        this.data = data;
        this.name = this.constructor.name;
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(this, this.constructor);
        } else {
            this.stack = (new Error(message)).stack;
        }
    }
}

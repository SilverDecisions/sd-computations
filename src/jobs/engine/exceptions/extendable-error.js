export class ExtendableError {
    data;
    constructor(message, data) {
        this.message = message;
        this.data = data;
        this.name = this.constructor.name;
    }
}


export class ItemReader{

    currentItemCount = 0;
    maxItemCount = Number.MAX_SAFE_INTEGER;

    constructor

    doRead(){

    }

    doOpen(){

    }

    doClose(){

    }



    open(executionContext){

    }

    read(){
        if (this.currentItemCount >= this.maxItemCount) {
            return null;
        }


    }

    close(executionContext){

    }




}

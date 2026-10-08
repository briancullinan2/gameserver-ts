import * as HappyDOMModule from 'happy-dom-without-node';

const workerSelf: {
	HappyDOM: typeof HappyDOMModule;
	Window: typeof HappyDOMModule.Window;
	GlobalWindow: typeof HappyDOMModule.GlobalWindow;
} = self as unknown as any;

// Explicitly register on Worker global scope
if(typeof self !== 'undefined')
{
	workerSelf.HappyDOM = HappyDOMModule;
	workerSelf.Window = HappyDOMModule.Window;
	workerSelf.GlobalWindow = HappyDOMModule.GlobalWindow;
}

export default HappyDOMModule;

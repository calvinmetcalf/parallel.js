(function(){
	var fAndF = function(fun,data){
		var promise = new RSVP.Promise();
		var worker = new Worker(URL.createObjectURL(new Blob(['var fun = ' + fun.toString()+';\
			self.onmessage=function(){\
			self.postMessage(fun('+JSON.stringify(data)+'));\
			self.close();\
			}\
		'],{type: "text/javascript"})));
		worker.onmessage=function(e){
			promise.resolve(e.data);
		};
		worker.onerror=function(e){
			promise.reject(e);
		};
		worker.postMessage("");
		return promise;
	};
	var sticksAround = function(fun){
		var w = {};
		var promises = [];
		var worker = new Worker(URL.createObjectURL(new Blob(['var func='+fun.toString()+';\
					self.onmessage=function(event){\
						self.postMessage([event.data[0],func(event.data[1])]);\
					}'],{type: "text/javascript"})));
		var rejectPromises = function(msg){
			promises.forEach(function(p){
				if(p){
					p.reject(msg);
				}	
			});
		};
		worker.onerror=rejectPromises;
		w.data=function(data){
			var i = promises.length;
			promises[i] = new RSVP.Promise();
			worker.onmessage=function(e){
				promises[e.data[0]].resolve(e.data[1]);
				promises[e.data[0]]=0;
			};
			worker.postMessage([i,data]);
			return promises[i];
		};
		w.close = function(){
			w.worker.terminate();
			rejectPromises("closed");
			return;
		};
		return w;
	};
})();
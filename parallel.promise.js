(function(){
	var makeWorker = function(strings){
	return new Worker(URL.createObjectURL(new Blob([strings.join("")],{type: "text/javascript"})));	
	};
	var fAndF = function(fun,data){
		var promise = new RSVP.Promise();
		var worker = makeWorker(['var fun = ',fun,';\
			self.onmessage=function(){\
				self.postMessage(fun(',JSON.stringify(data),'));\
				self.close();\
			}']);
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
		var worker = makeWorker(['var fun=', fun,';\
					self.onmessage=function(event){\
						self.postMessage([event.data[0],funcevent.data[1])]);\
					}']);
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
	var mWorker=function(fun,callback){
		var w ={};
		var worker = makeWorker(['var fun = ',fun,';\
			self.onmessage=function(e){\
				self.postMessage(fun(e.data));\
			}']);
		worker.onmessage = function(e){
			callback(e.data);	
		};
		w.data=function(d){
			worker.postMessage(d);	
		};
		w.close=function(){
			return worker.terminate();
		};
		return w;
	};
	var rWorker = function(fun,callback){
		var w = {};
		var worker = makeWorker('var fun = ',fun,',reduced,reduceEmpty=true;\
		self.onmessage=function(event){\
			switch(event.data[0]){\
				case "data":\
					if(reduceEmpty){\
						reduced = event.data[1];\
						reduceEmpty = false;\
					}else{\
						reduced = func(reduced,event.data[1]);\
					}\
					break;\
				case "get":\
					self.postMessage(reduced);\
					break;\
				case "close":\
					self.postMessage(reduced);\
					self.close();\
					break;\
			}\
		};');
		worker.onmessage=function(e){
			callback(e.data);	
		};
		w.data=function(data){
			worker.postMessage(["data",data]);
		};
		w.fetch=function(){
			worker.postMessage(["get"]);
		};
		w.close=function(silent){
			if(silent){
				callback=function(){};
			}
			worker.postMessage(["close"]);
		};
	};
	var nonIncrementalMapReduce = function(threads){
		var w={};
		var data=[];
		var len = 0;
		var promise = new RSVP.Promise();
		var workers = [];
		var terminated = 0;
		var reducer;
		var status = {
			map:false,
			reduce:false,
			data:false
		};
		var checkStatus = function(){
			if(status.map && status.reduce && status.data){
				return go();
			}else{
				return w;
			}
		};
		w.map=function(fun){
			if(status.map){
				return w;
			}
			var i = 0;
			while(i<threads){
				(function(){
					var mw = mWorker(fun, function(d){
						reducer.data(d);
						if(len>0){
							len--;
							mw.data(data.pop());
						}else{
							terminated++;
							mw.close();
							if(terminated===threads){
								reducer.close();
							}
						}
					});
				workers.push(fun,mw);
				})();
				i++;
			}
			status.map=true;
			return checkStatus();
		};
		w.reduce=function(fun){
			if(status.reduce){
				return w;
			}
			reducer = rWorker(fun,function(d){
				promise.resolve(d);
			});
			status.reduce=true;
			return checkStatus();
		};
		w.data = function(d){
			len = len + d.length;
			data = data.concat(d);
			status.data=true;
			return checkStatus();
		};
		function go(){
			var i = 0;
			var wlen = workers.length;
			while(i<wlen && len>0){
				len--;
				workers[i].data(data.pop());
				i++;
			}
			return promise;
		}
		return w;
	};
	var incrementalMapReduce = function(threads){
		var w={};
		var data=[];
		var len = 0;
		var promise = new RSVP.Promise();
		var workers = [];
		var idle = threads;
		var reducer;
		var waiting=false;
		var closing=false;
		var status = {
			map:false,
			reduce:false,
			data:false
		};
		var checkStatus = function(){
			if(status.map && status.reduce && status.data){
				return go();
			}else{
				return w;
			}
		};
		w.map=function(fun){
			if(status.map){
				return w;
			}
			var i = 0;
			while(i<threads){
				(function(){
					var mw = mWorker(fun, function(d){
						reducer.data(d);
						if(len>0){
							len--;
							mw.data(data.pop());
						}else{ 
							idle++;
							if(idle===threads){
								data=false;
								if(closing){
								closeUp();
								}else if(waiting){
									reducer.fetch();
								}
							}
						}
					});
				workers.push(fun,mw);
				})();
				i++;
			}
			status.map=true;
			return checkStatus();
		};
		w.reduce=function(fun){
			if(status.reduce){
				return w;
			}
			reducer = rWorker(fun,function(d){
				promise.resolve(d);
			});
			status.reduce=true;
			return checkStatus();
		};
		w.data = function(d){
			len = len + d.length;
			data = data.concat(d);
			status.data=true;
			return checkStatus();
		};
		function go(){
			var i = 0;
			var wlen = workers.length;
			while(i<wlen && len>0 && !idle){
				len--;
				workers[i].data(data.pop());
				i++;
				idle--;
			}
			return w;
		}
		w.fetch=function(){
			if(data){
				waiting=true;
			}else{
				reducer.fetch();
			}
			return promise;
		};
		w.close=function(){
			if(data){
				closing=true;
			}else{
				closeUp();
			}
			return promise;
		};
		function closeUp(){
			reducer.close();
			workers.forEach(function(v){
				v.close();	
			});
		}
		return w;
	};
	window.promise=function(a,b){
		if(typeof a === "function"){
			return b ? fAndF(a,b):sticksAround(a);
		}else if(typeof a === "number"){
			return b ? nonIncrementalMapReduce(a):incrementalMapReduce(a);
		}
	};
})();
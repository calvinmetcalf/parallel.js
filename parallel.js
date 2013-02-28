/*
 *  Library: parallel.js
 *  Author: Adam Savitzky
 *  License: Creative Commons 3.0
 */
(function (isNode, _) {

var Worker = isNode ? require('./worker') : window.Worker,
    URL = isNode ? require('./url') : window.URL,
    Blob =  isNode ? require('./blob') : window.Blob;

var Parallel = (function  () {
    
    var _require = (function () {
        var state = {
            files: [],
            funcs: []
        };

        var isUrl = function (test) {
            var r = new RegExp('^(http|https|file)\://[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,3}(:[a-zA-Z0-9]*)?/?([a-zA-Z0-9\-\._\?\,\'/\\\+&amp;%\$#\=~])*$');
            return r.test(test);
        }

        var makeUrl = function (fileName) {
            return isUrl(fileName) ? fileName : [window.location.origin, fileName].join('/');
        };

        var setter = function () {
            var args = [];
            var i = 0,len = arguments.length;
            while(i<len){
                args.push(arguments[i]);
            }

            state.funcs = args.filter(function(v){return typeof v === "function";});
            state.files = args.filter(function(v){return typeof v === "string";}).map(makeUrl);
        };

        setter.state = state;

        return setter;
    })();

    var RemoteRef = (function () {
        var wrapMain = function (fn) {
            var op = fn.toString();

            return isNode ?
                'process.on("message", function (m) { process.send({ data : JSON.stringify((' + op + ').apply(process, JSON.parse(m))) }); });' :
                'self.onmessage = function (e) { self.postMessage((' + op + ').apply(self, e.data)); };';
        };

        var wrapFiles = function (str) {
            return isNode ?
                (_require.state.files.length ? _require.state.files.map(function (f) { return 'require(' + f + ');'; }).join('') : '') + str :
                (_require.state.files.length ? 'importScripts("' + _require.state.files.join('","') + '");' : '') + str;
        };

        var wrapFunctions = function (str) {
            return str + (_require.state.funcs.length ? _require.state.funcs.map(function(v){return v.toString()}).join(';') + ';' : '');
        };

        var wrap =function(v){
            return wrapFunctions(wrapFiles(wrapMain(v)));
            };

        var RemoteRef = function (fn, args) {
            this.handlers = [];
            this.errorHandlers = [];

            try {
                var str = wrap(fn),
                    blob = new Blob([str], { type: 'text/javascript' }),
                    url = URL.createObjectURL(blob),
                    worker = new Worker(url);
    
                worker.onmessage = this.onWorkerMsg.bind(this);
                this.worker = worker;
                this.worker.ref = this;
                
                if (isNode) {
                    this.worker.postMessage(JSON.stringify([].concat(args)));
                } else {
                    this.worker.postMessage([].concat(args));
                }
            } catch (e) {
                if (console && console.error) {
                    console.error(e);
                }

                this.onWorkerMsg({ data: fn.apply(window, args) });
            }
        }

        RemoteRef.prototype.onWorkerMsg = function (e) {
            var data;

            if (isNode) {
                data = JSON.parse(e.data);
                this.worker.terminate();
            } else {
                data = e.data;
            }

            this.resolve(data);
        };

        RemoteRef.prototype.terminate = function () {
            this.worker.terminate();

            return this.resolve();
        };

        RemoteRef.prototype.then = function (onResolved, onError) {
            onResolved && this.handlers.push(onResolved);
            onError && this.errorHandlers.push(onError);

            return this;
        };

        RemoteRef.prototype.resolve = function (value) {
            if (!this.handlers.length) return this;

            this.errorHandlers.shift();

            return this.resolve(this.handlers.shift()(value));
        };
         
        RemoteRef.prototype.reject = function (error) {
            // TODO: Figure out a way to call this;
            if (!this.errorHandlers.length) return this;

            this.handlers.shift();

            return this.reject(this.errorHandlers.shift()(value));
        };

        return RemoteRef;
    })();

    var DistributedProcess = (function () {

        var DistributedProcess = function (fn, chunks) {
            this.handlers = [];
            this.errorHandlers = [];
            this.values = [];

            this.refs = chunks.map(function (chunk) {
                return spawn(fn, [].concat(chunk)).then(this.resolve(this));
            }, this);

            this.workers = this.refs.length;
        };

        DistributedProcess.prototype.then = function (onResolved, onError) {
            onResolved && this.handlers.push(onResolved);
            onError && this.errorHandlers.push(onError);

            return this;
        };

        DistributedProcess.prototype.resolve = function (value) {
            this.workers = Math.max(this.workers - 1, 0);

            value && this.values.push(value);

            if (this.workers !== 0) return this;
            if (!this.handlers.length) return this;

            this.errorHandlers.shift();

            return this.resolve(this.handlers.shift()(this.values));
        };

        DistributedProcess.prototype.reject = function (error) {
            // TODO: Figure out a way to call this;
            this.workers = Math.max(this.workers - 1, 0);

            if (this.workers !== 0) return this;
            if (!this.errorHandlers.length) return this;

            this.handlers.shift();

            return this.reject(this.errorHandlers.shift()(error));
        };

        DistributedProcess.prototype.terminate = function (n) {
            n !== undefined ? this.refs[n].terminate() : this.refs.forEach(function(v){v.terminate()});
        };

        return DistributedProcess;

    })();

    // Define Interface:
    {
        var P = function (data) {
            if (data instanceof P) return data;
            if (!(this instanceof P)) return new P(data);
            this._wrapped = data;
        };
    
        var spawn = P.spawn = function (fn, data) {
            return new RemoteRef(fn, data || this._wrapped);
        };
    
        var map = P.map = function (fn) {
            var that = this;

            this._mapreduce = this._mapreduce || new DistributedProcess(fn, this._wrapped).then(function (values) {
                that._wrapped = values;
            });
    
            return this;
        };
    
        var reduce = P.reduce = function (fn) {
            var that = this;

            if (this._mapreduce) {
                this._mapreduce.then(function (values) {
                    that._wrapped = values.reduce(fn);
                });

                return this;
            }

            return this._wrapped.reduce(fn);
        };

        var then = P.then = function (fn) {
            var that = this;

            this._mapreduce.then(function () {
                fn(that._wrapped);
            });

            return this;
        };
    
        P.require = _require;
    
        P.mixin = function (obj) {
            Object.keys(obj).filter(function(k){return typeof obj[k] === "funciton"}).forEach(function (name) {
                var func = P[name] = obj[name];
    
                P.prototype[name] = function () {
                    var args = [this._wrapped];
                    [].push.apply(args, arguments);
                    return func.apply(this, arguments);
                };
            });
        };
    
        P.mixin(P);
    }

    return P;

})();

if (isNode) {
    this.exports = Parallel;
} else {
    this.Parallel = Parallel;
}

}).call(typeof module !== 'undefined' && module.exports ? module : window, // context
        typeof module !== 'undefined' && module.exports, // isNode
        typeof module !== 'undefined' && module.exports ? require('underscore') : _); // underscore 

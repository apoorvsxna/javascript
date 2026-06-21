diff --git a/papaparse.js b/papaparse.js
index b98897a..ce75421 100755
--- a/papaparse.js
+++ b/papaparse.js
@@ -289,6 +289,9 @@ License: MIT
 		/** the columns (keys) we expect when we unparse objects */
 		var _columns = null;
 
+		/** whether to flatten nested objects and arrays into path headers */
+		var _nested = false;
+
 		/** whether to prevent outputting cells that can be parsed as formulae by spreadsheet software (Excel and LibreOffice) */
 		var _escapeFormulae = false;
 
@@ -304,7 +307,9 @@ License: MIT
 			if (!_input.length || Array.isArray(_input[0]))
 				return serialize(null, _input, _skipEmptyLines);
 			else if (typeof _input[0] === 'object')
-				return serialize(_columns || Object.keys(_input[0]), _input, _skipEmptyLines);
+				return _nested
+					? serializeNested(_columns || collectNestedColumns(_input), _input, _skipEmptyLines)
+					: serialize(_columns || Object.keys(_input[0]), _input, _skipEmptyLines);
 		}
 		else if (typeof _input === 'object')
 		{
@@ -317,17 +322,24 @@ License: MIT
 					_input.fields = _input.meta && _input.meta.fields || _columns;
 
 				if (!_input.fields)
-					_input.fields =  Array.isArray(_input.data[0])
-						? _input.fields
-						: typeof _input.data[0] === 'object'
-							? Object.keys(_input.data[0])
-							: [];
+				{
+					if (_nested && !Array.isArray(_input.data[0]) && typeof _input.data[0] === 'object')
+						_input.fields = collectNestedColumns(_input.data);
+					else if (Array.isArray(_input.data[0]))
+						_input.fields = _input.fields;
+					else if (typeof _input.data[0] === 'object')
+						_input.fields = Object.keys(_input.data[0]);
+					else
+						_input.fields = [];
+				}
 
 				if (!(Array.isArray(_input.data[0])) && typeof _input.data[0] !== 'object')
 					_input.data = [_input.data];	// handles input like [1,2,3] or ['asdf']
 			}
 
-			return serialize(_input.fields || [], _input.data || [], _skipEmptyLines);
+			return _nested && _input.data && !(Array.isArray(_input.data[0]))
+				? serializeNested(_input.fields || [], _input.data || [], _skipEmptyLines)
+				: serialize(_input.fields || [], _input.data || [], _skipEmptyLines);
 		}
 
 		// Default (any valid paths should return before this)
@@ -372,6 +384,9 @@ License: MIT
 				_columns = _config.columns;
 			}
 
+			if (typeof _config.nested === 'boolean')
+				_nested = _config.nested;
+
 			if (_config.escapeChar !== undefined) {
 				_escapedQuote = _config.escapeChar + _quoteChar;
 			}
@@ -446,6 +461,36 @@ License: MIT
 			return csv;
 		}
 
+		function serializeNested(fields, data, skipEmptyLines)
+		{
+			var rows = [];
+			var parsedFields = fields.map(function(field) {
+				var parsed = parseNestedPath(field);
+				return parsed.error ? [{ type: 'key', key: field }] : parsed.parts;
+			});
+
+			for (var row = 0; row < data.length; row++)
+			{
+				var output = {};
+				for (var col = 0; col < fields.length; col++)
+					output[fields[col]] = getNestedValue(data[row], parsedFields[col]);
+				rows.push(output);
+			}
+
+			return serialize(fields, rows, skipEmptyLines);
+		}
+
+		function collectNestedColumns(data)
+		{
+			var columns = [];
+			var columnLookup = {};
+
+			for (var row = 0; row < data.length; row++)
+				flattenNestedValue(data[row], [], columns, columnLookup, []);
+
+			return columns;
+		}
+
 		/** Encloses a value around quotes if needed (makes a value safe for CSV insertion) */
 		function safe(str, col)
 		{
@@ -487,6 +532,234 @@ License: MIT
 		}
 	}
 
+	function isNestedContainer(value)
+	{
+		return value && typeof value === 'object' && value.constructor !== Date;
+	}
+
+	function pathKeyNeedsQuoting(key)
+	{
+		return key === '' || /[.[\]"]/.test(key);
+	}
+
+	function stringifyPathSegment(part)
+	{
+		if (part.type === 'index')
+			return '[' + part.index + ']';
+
+		var escapedKey = part.key.replace(/"/g, '\\"');
+		if (pathKeyNeedsQuoting(part.key))
+			return '["' + escapedKey + '"]';
+		return part.key;
+	}
+
+	function stringifyNestedPath(parts)
+	{
+		var path = '';
+		for (var i = 0; i < parts.length; i++)
+		{
+			if (parts[i].type === 'key' && i > 0 && !pathKeyNeedsQuoting(parts[i].key))
+				path += '.';
+			path += stringifyPathSegment(parts[i]);
+		}
+		return path;
+	}
+
+	function parseNestedPath(path)
+	{
+		var parts = [];
+		var i = 0;
+		var expectingSegment = true;
+
+		if (typeof path !== 'string' || path.length === 0)
+			return { error: true, parts: [{ type: 'key', key: path }] };
+
+		while (i < path.length)
+		{
+			if (path[i] === '.')
+			{
+				if (expectingSegment)
+					return { error: true, parts: [{ type: 'key', key: path }] };
+				expectingSegment = true;
+				i++;
+				continue;
+			}
+
+			if (path[i] === '[')
+			{
+				if (path[i + 1] === '"')
+				{
+					var key = '';
+					i += 2;
+					while (i < path.length)
+					{
+						if (path[i] === '\\' && path[i + 1] === '"')
+						{
+							key += '"';
+							i += 2;
+						}
+						else if (path[i] === '"')
+							break;
+						else
+							key += path[i++];
+					}
+					if (path[i] !== '"' || path[i + 1] !== ']')
+						return { error: true, parts: [{ type: 'key', key: path }] };
+					parts.push({ type: 'key', key: key });
+					i += 2;
+					expectingSegment = false;
+					continue;
+				}
+
+				var start = ++i;
+				while (i < path.length && path[i] !== ']')
+					i++;
+				if (path[i] !== ']' || start === i)
+					return { error: true, parts: [{ type: 'key', key: path }] };
+				var index = path.slice(start, i);
+				if (!/^0$|^[1-9][0-9]*$/.test(index))
+					return { error: true, parts: [{ type: 'key', key: path }] };
+				parts.push({ type: 'index', index: parseInt(index) });
+				i++;
+				expectingSegment = false;
+				continue;
+			}
+
+			var keyStart = i;
+			while (i < path.length && path[i] !== '.' && path[i] !== '[' && path[i] !== ']')
+				i++;
+			if (keyStart === i || path[i] === ']')
+				return { error: true, parts: [{ type: 'key', key: path }] };
+			parts.push({ type: 'key', key: path.slice(keyStart, i) });
+			expectingSegment = false;
+		}
+
+		if (expectingSegment)
+			return { error: true, parts: [{ type: 'key', key: path }] };
+
+		return { parts: parts };
+	}
+
+	function flattenNestedValue(value, parts, columns, columnLookup, stack)
+	{
+		if (isNestedContainer(value))
+		{
+			if (stack.indexOf(value) !== -1)
+				throw new Error('Circular reference detected');
+
+			stack.push(value);
+
+			if (Array.isArray(value))
+			{
+				if (value.length === 0 && parts.length)
+					addNestedColumn(parts, columns, columnLookup);
+				for (var index = 0; index < value.length; index++)
+					flattenNestedValue(Object.prototype.hasOwnProperty.call(value, index) ? value[index] : null, parts.concat([{ type: 'index', index: index }]), columns, columnLookup, stack);
+			}
+			else
+			{
+				var keys = Object.keys(value);
+				if (keys.length === 0 && parts.length)
+					addNestedColumn(parts, columns, columnLookup);
+				for (var j = 0; j < keys.length; j++)
+					flattenNestedValue(value[keys[j]], parts.concat([{ type: 'key', key: keys[j] }]), columns, columnLookup, stack);
+			}
+
+			stack.pop();
+			return;
+		}
+
+		addNestedColumn(parts, columns, columnLookup);
+	}
+
+	function addNestedColumn(parts, columns, columnLookup)
+	{
+		var column = stringifyNestedPath(parts);
+		if (!Object.prototype.hasOwnProperty.call(columnLookup, column))
+		{
+			columnLookup[column] = true;
+			columns.push(column);
+		}
+	}
+
+	function getNestedValue(value, parts)
+	{
+		for (var i = 0; i < parts.length; i++)
+		{
+			if (value === null || typeof value === 'undefined')
+				return undefined;
+			value = parts[i].type === 'index' ? value[parts[i].index] : value[parts[i].key];
+		}
+		return isNestedContainer(value) ? JSON.stringify(value) : value;
+	}
+
+	function setNestedValue(row, field, value, addError, rowNumber)
+	{
+		var parsed = parseNestedPath(field);
+		if (parsed.error)
+		{
+			addError('NestedField', 'MalformedPath', 'Malformed path header: ' + field, rowNumber);
+			row[field] = value;
+			return;
+		}
+
+		var current = row;
+		var parts = parsed.parts;
+		for (var i = 0; i < parts.length; i++)
+		{
+			var part = parts[i];
+			var isLast = i === parts.length - 1;
+			var key = part.type === 'index' ? part.index : part.key;
+			var nextPart = parts[i + 1];
+
+			if (Array.isArray(current) && part.type !== 'index')
+			{
+				addError('NestedField', 'ContainerConflict', 'Nested path conflict at header: ' + field, rowNumber);
+				return;
+			}
+
+			if (isLast)
+			{
+				if (isNestedContainer(current[key]))
+				{
+					addError('NestedField', 'ValueConflict', 'Nested path conflict at header: ' + field, rowNumber);
+					return;
+				}
+				if (Array.isArray(current) && key >= current.length)
+					fillArrayGaps(current, key);
+				current[key] = value;
+				return;
+			}
+
+			var expectedArray = nextPart.type === 'index';
+			if (current[key] === undefined || current[key] === null || current[key] === '')
+			{
+				if (Array.isArray(current) && key >= current.length)
+					fillArrayGaps(current, key);
+				current[key] = expectedArray ? [] : {};
+			}
+			else if (!isNestedContainer(current[key]))
+			{
+				addError('NestedField', 'ValueConflict', 'Nested path conflict at header: ' + field, rowNumber);
+				return;
+			}
+			else if (Array.isArray(current[key]) !== expectedArray)
+			{
+				addError('NestedField', 'ContainerConflict', 'Nested path conflict at header: ' + field, rowNumber);
+				return;
+			}
+
+			current = current[key];
+		}
+	}
+
+	function fillArrayGaps(array, index)
+	{
+		for (var i = array.length; i < index; i++)
+			array[i] = null;
+	}
+
+
 
 	/** ChunkStreamer is the base prototype for various streamer implementations. */
 	function ChunkStreamer(config)
@@ -1308,6 +1581,8 @@ License: MIT
 						row[field] = row[field] || [];
 						row[field].push(value);
 					}
+					else if (_config.nested)
+						setNestedValue(row, field, value, addError, _rowCounter + i);
 					else
 						row[field] = value;
 				}
diff --git a/papaparse.min.js b/papaparse.min.js
index f314110..2a6a931 100644
--- a/papaparse.min.js
+++ b/papaparse.min.js
@@ -4,4 +4,4 @@ v5.5.3
 https://github.com/mholt/PapaParse
 License: MIT
 */
-((e,t)=>{"function"==typeof define&&define.amd?define([],t):"object"==typeof module&&"undefined"!=typeof exports?module.exports=t():e.Papa=t()})(this,function r(){var n="undefined"!=typeof self?self:"undefined"!=typeof window?window:void 0!==n?n:{};var d,s=!n.document&&!!n.postMessage,a=n.IS_PAPA_WORKER||!1,o={},h=0,v={};function u(e){this._handle=null,this._finished=!1,this._completed=!1,this._halted=!1,this._input=null,this._baseIndex=0,this._partialLine="",this._rowCount=0,this._start=0,this._nextChunk=null,this.isFirstChunk=!0,this._completeResults={data:[],errors:[],meta:{}},function(e){var t=b(e);t.chunkSize=parseInt(t.chunkSize),e.step||e.chunk||(t.chunkSize=null);this._handle=new i(t),(this._handle.streamer=this)._config=t}.call(this,e),this.parseChunk=function(t,e){var i=parseInt(this._config.skipFirstNLines)||0;if(this.isFirstChunk&&0<i){let e=this._config.newline;e||(r=this._config.quoteChar||'"',e=this._handle.guessLineEndings(t,r)),t=[...t.split(e).slice(i)].join(e)}this.isFirstChunk&&U(this._config.beforeFirstChunk)&&void 0!==(r=this._config.beforeFirstChunk(t))&&(t=r),this.isFirstChunk=!1,this._halted=!1;var i=this._partialLine+t,r=(this._partialLine="",this._handle.parse(i,this._baseIndex,!this._finished));if(!this._handle.paused()&&!this._handle.aborted()){t=r.meta.cursor,i=(this._finished||(this._partialLine=i.substring(t-this._baseIndex),this._baseIndex=t),r&&r.data&&(this._rowCount+=r.data.length),this._finished||this._config.preview&&this._rowCount>=this._config.preview);if(a)n.postMessage({results:r,workerId:v.WORKER_ID,finished:i});else if(U(this._config.chunk)&&!e){if(this._config.chunk(r,this._handle),this._handle.paused()||this._handle.aborted())return void(this._halted=!0);this._completeResults=r=void 0}return this._config.step||this._config.chunk||(this._completeResults.data=this._completeResults.data.concat(r.data),this._completeResults.errors=this._completeResults.errors.concat(r.errors),this._completeResults.meta=r.meta),this._completed||!i||!U(this._config.complete)||r&&r.meta.aborted||(this._config.complete(this._completeResults,this._input),this._completed=!0),i||r&&r.meta.paused||this._nextChunk(),r}this._halted=!0},this._sendError=function(e){U(this._config.error)?this._config.error(e):a&&this._config.error&&n.postMessage({workerId:v.WORKER_ID,error:e,finished:!1})}}function f(e){var r;(e=e||{}).chunkSize||(e.chunkSize=v.RemoteChunkSize),u.call(this,e),this._nextChunk=s?function(){this._readChunk(),this._chunkLoaded()}:function(){this._readChunk()},this.stream=function(e){this._input=e,this._nextChunk()},this._readChunk=function(){if(this._finished)this._chunkLoaded();else{if(r=new XMLHttpRequest,this._config.withCredentials&&(r.withCredentials=this._config.withCredentials),s||(r.onload=y(this._chunkLoaded,this),r.onerror=y(this._chunkError,this)),r.open(this._config.downloadRequestBody?"POST":"GET",this._input,!s),this._config.downloadRequestHeaders){var e,t=this._config.downloadRequestHeaders;for(e in t)r.setRequestHeader(e,t[e])}var i;this._config.chunkSize&&(i=this._start+this._config.chunkSize-1,r.setRequestHeader("Range","bytes="+this._start+"-"+i));try{r.send(this._config.downloadRequestBody)}catch(e){this._chunkError(e.message)}s&&0===r.status&&this._chunkError()}},this._chunkLoaded=function(){4===r.readyState&&(r.status<200||400<=r.status?this._chunkError():(this._start+=this._config.chunkSize||r.responseText.length,this._finished=!this._config.chunkSize||this._start>=(e=>null!==(e=e.getResponseHeader("Content-Range"))?parseInt(e.substring(e.lastIndexOf("/")+1)):-1)(r),this.parseChunk(r.responseText)))},this._chunkError=function(e){e=r.statusText||e;this._sendError(new Error(e))}}function l(e){(e=e||{}).chunkSize||(e.chunkSize=v.LocalChunkSize),u.call(this,e);var i,r,n="undefined"!=typeof FileReader;this.stream=function(e){this._input=e,r=e.slice||e.webkitSlice||e.mozSlice,n?((i=new FileReader).onload=y(this._chunkLoaded,this),i.onerror=y(this._chunkError,this)):i=new FileReaderSync,this._nextChunk()},this._nextChunk=function(){this._finished||this._config.preview&&!(this._rowCount<this._config.preview)||this._readChunk()},this._readChunk=function(){var e=this._input,t=(this._config.chunkSize&&(t=Math.min(this._start+this._config.chunkSize,this._input.size),e=r.call(e,this._start,t)),i.readAsText(e,this._config.encoding));n||this._chunkLoaded({target:{result:t}})},this._chunkLoaded=function(e){this._start+=this._config.chunkSize,this._finished=!this._config.chunkSize||this._start>=this._input.size,this.parseChunk(e.target.result)},this._chunkError=function(){this._sendError(i.error)}}function c(e){var i;u.call(this,e=e||{}),this.stream=function(e){return i=e,this._nextChunk()},this._nextChunk=function(){var e,t;if(!this._finished)return e=this._config.chunkSize,i=e?(t=i.substring(0,e),i.substring(e)):(t=i,""),this._finished=!i,this.parseChunk(t)}}function p(e){u.call(this,e=e||{});var t=[],i=!0,r=!1;this.pause=function(){u.prototype.pause.apply(this,arguments),this._input.pause()},this.resume=function(){u.prototype.resume.apply(this,arguments),this._input.resume()},this.stream=function(e){this._input=e,this._input.on("data",this._streamData),this._input.on("end",this._streamEnd),this._input.on("error",this._streamError)},this._checkIsFinished=function(){r&&1===t.length&&(this._finished=!0)},this._nextChunk=function(){this._checkIsFinished(),t.length?this.parseChunk(t.shift()):i=!0},this._streamData=y(function(e){try{t.push("string"==typeof e?e:e.toString(this._config.encoding)),i&&(i=!1,this._checkIsFinished(),this.parseChunk(t.shift()))}catch(e){this._streamError(e)}},this),this._streamError=y(function(e){this._streamCleanUp(),this._sendError(e)},this),this._streamEnd=y(function(){this._streamCleanUp(),r=!0,this._streamData("")},this),this._streamCleanUp=y(function(){this._input.removeListener("data",this._streamData),this._input.removeListener("end",this._streamEnd),this._input.removeListener("error",this._streamError)},this)}function i(m){var n,s,a,t,o=Math.pow(2,53),h=-o,u=/^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/,d=/^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/,i=this,r=0,f=0,l=!1,e=!1,c=[],p={data:[],errors:[],meta:{}};function y(e){return"greedy"===m.skipEmptyLines?""===e.join("").trim():1===e.length&&0===e[0].length}function g(){if(p&&a&&(k("Delimiter","UndetectableDelimiter","Unable to auto-detect delimiting character; defaulted to '"+v.DefaultDelimiter+"'"),a=!1),m.skipEmptyLines&&(p.data=p.data.filter(function(e){return!y(e)})),_()){if(p)if(Array.isArray(p.data[0])){for(var e=0;_()&&e<p.data.length;e++)p.data[e].forEach(t);p.data.splice(0,1)}else p.data.forEach(t);function t(e,t){U(m.transformHeader)&&(e=m.transformHeader(e,t)),c.push(e)}}function i(e,t){for(var i=m.header?{}:[],r=0;r<e.length;r++){var n=r,s=e[r],s=((e,t)=>(e=>(m.dynamicTypingFunction&&void 0===m.dynamicTyping[e]&&(m.dynamicTyping[e]=m.dynamicTypingFunction(e)),!0===(m.dynamicTyping[e]||m.dynamicTyping)))(e)?"true"===t||"TRUE"===t||"false"!==t&&"FALSE"!==t&&((e=>{if(u.test(e)){e=parseFloat(e);if(h<e&&e<o)return 1}})(t)?parseFloat(t):d.test(t)?new Date(t):""===t?null:t):t)(n=m.header?r>=c.length?"__parsed_extra":c[r]:n,s=m.transform?m.transform(s,n):s);"__parsed_extra"===n?(i[n]=i[n]||[],i[n].push(s)):i[n]=s}return m.header&&(r>c.length?k("FieldMismatch","TooManyFields","Too many fields: expected "+c.length+" fields but parsed "+r,f+t):r<c.length&&k("FieldMismatch","TooFewFields","Too few fields: expected "+c.length+" fields but parsed "+r,f+t)),i}var r;p&&(m.header||m.dynamicTyping||m.transform)&&(r=1,!p.data.length||Array.isArray(p.data[0])?(p.data=p.data.map(i),r=p.data.length):p.data=i(p.data,0),m.header&&p.meta&&(p.meta.fields=c),f+=r)}function _(){return m.header&&0===c.length}function k(e,t,i,r){e={type:e,code:t,message:i};void 0!==r&&(e.row=r),p.errors.push(e)}U(m.step)&&(t=m.step,m.step=function(e){p=e,_()?g():(g(),0!==p.data.length&&(r+=e.data.length,m.preview&&r>m.preview?s.abort():(p.data=p.data[0],t(p,i))))}),this.parse=function(e,t,i){var r=m.quoteChar||'"',r=(m.newline||(m.newline=this.guessLineEndings(e,r)),a=!1,m.delimiter?U(m.delimiter)&&(m.delimiter=m.delimiter(e),p.meta.delimiter=m.delimiter):((r=((e,t,i,r,n)=>{var s,a,o,h;n=n||[",","\t","|",";",v.RECORD_SEP,v.UNIT_SEP];for(var u=0;u<n.length;u++){for(var d,f=n[u],l=0,c=0,p=0,g=(o=void 0,new E({comments:r,delimiter:f,newline:t,preview:10}).parse(e)),_=0;_<g.data.length;_++)i&&y(g.data[_])?p++:(d=g.data[_].length,c+=d,void 0===o?o=d:0<d&&(l+=Math.abs(d-o),o=d));0<g.data.length&&(c/=g.data.length-p),(void 0===a||l<=a)&&(void 0===h||h<c)&&1.99<c&&(a=l,s=f,h=c)}return{successful:!!(m.delimiter=s),bestDelimiter:s}})(e,m.newline,m.skipEmptyLines,m.comments,m.delimitersToGuess)).successful?m.delimiter=r.bestDelimiter:(a=!0,m.delimiter=v.DefaultDelimiter),p.meta.delimiter=m.delimiter),b(m));return m.preview&&m.header&&r.preview++,n=e,s=new E(r),p=s.parse(n,t,i),g(),l?{meta:{paused:!0}}:p||{meta:{paused:!1}}},this.paused=function(){return l},this.pause=function(){l=!0,s.abort(),n=U(m.chunk)?"":n.substring(s.getCharIndex())},this.resume=function(){i.streamer._halted?(l=!1,i.streamer.parseChunk(n,!0)):setTimeout(i.resume,3)},this.aborted=function(){return e},this.abort=function(){e=!0,s.abort(),p.meta.aborted=!0,U(m.complete)&&m.complete(p),n=""},this.guessLineEndings=function(e,t){e=e.substring(0,1048576);var t=new RegExp(P(t)+"([^]*?)"+P(t),"gm"),i=(e=e.replace(t,"")).split("\r"),t=e.split("\n"),e=1<t.length&&t[0].length<i[0].length;if(1===i.length||e)return"\n";for(var r=0,n=0;n<i.length;n++)"\n"===i[n][0]&&r++;return r>=i.length/2?"\r\n":"\r"}}function P(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function E(C){var S=(C=C||{}).delimiter,O=C.newline,x=C.comments,I=C.step,A=C.preview,T=C.fastMode,D=null,L=!1,F=null==C.quoteChar?'"':C.quoteChar,j=F;if(void 0!==C.escapeChar&&(j=C.escapeChar),("string"!=typeof S||-1<v.BAD_DELIMITERS.indexOf(S))&&(S=","),x===S)throw new Error("Comment character same as delimiter");!0===x?x="#":("string"!=typeof x||-1<v.BAD_DELIMITERS.indexOf(x))&&(x=!1),"\n"!==O&&"\r"!==O&&"\r\n"!==O&&(O="\n");var z=0,M=!1;this.parse=function(i,t,r){if("string"!=typeof i)throw new Error("Input must be a string");var n=i.length,e=S.length,s=O.length,a=x.length,o=U(I),h=[],u=[],d=[],f=z=0;if(!i)return w();if(T||!1!==T&&-1===i.indexOf(F)){for(var l=i.split(O),c=0;c<l.length;c++){if(d=l[c],z+=d.length,c!==l.length-1)z+=O.length;else if(r)return w();if(!x||d.substring(0,a)!==x){if(o){if(h=[],k(d.split(S)),R(),M)return w()}else k(d.split(S));if(A&&A<=c)return h=h.slice(0,A),w(!0)}}return w()}for(var p=i.indexOf(S,z),g=i.indexOf(O,z),_=new RegExp(P(j)+P(F),"g"),m=i.indexOf(F,z);;)if(i[z]===F)for(m=z,z++;;){if(-1===(m=i.indexOf(F,m+1)))return r||u.push({type:"Quotes",code:"MissingQuotes",message:"Quoted field unterminated",row:h.length,index:z}),E();if(m===n-1)return E(i.substring(z,m).replace(_,F));if(F===j&&i[m+1]===j)m++;else if(F===j||0===m||i[m-1]!==j){-1!==p&&p<m+1&&(p=i.indexOf(S,m+1));var y=v(-1===(g=-1!==g&&g<m+1?i.indexOf(O,m+1):g)?p:Math.min(p,g));if(i.substr(m+1+y,e)===S){d.push(i.substring(z,m).replace(_,F)),i[z=m+1+y+e]!==F&&(m=i.indexOf(F,z)),p=i.indexOf(S,z),g=i.indexOf(O,z);break}y=v(g);if(i.substring(m+1+y,m+1+y+s)===O){if(d.push(i.substring(z,m).replace(_,F)),b(m+1+y+s),p=i.indexOf(S,z),m=i.indexOf(F,z),o&&(R(),M))return w();if(A&&h.length>=A)return w(!0);break}u.push({type:"Quotes",code:"InvalidQuotes",message:"Trailing quote on quoted field is malformed",row:h.length,index:z}),m++}}else if(x&&0===d.length&&i.substring(z,z+a)===x){if(-1===g)return w();z=g+s,g=i.indexOf(O,z),p=i.indexOf(S,z)}else if(-1!==p&&(p<g||-1===g))d.push(i.substring(z,p)),z=p+e,p=i.indexOf(S,z);else{if(-1===g)break;if(d.push(i.substring(z,g)),b(g+s),o&&(R(),M))return w();if(A&&h.length>=A)return w(!0)}return E();function k(e){h.push(e),f=z}function v(e){var t=0;return t=-1!==e&&(e=i.substring(m+1,e))&&""===e.trim()?e.length:t}function E(e){return r||(void 0===e&&(e=i.substring(z)),d.push(e),z=n,k(d),o&&R()),w()}function b(e){z=e,k(d),d=[],g=i.indexOf(O,z)}function w(e){if(C.header&&!t&&h.length&&!L){var s=h[0],a=Object.create(null),o=new Set(s);let n=!1;for(let r=0;r<s.length;r++){let i=s[r];if(a[i=U(C.transformHeader)?C.transformHeader(i,r):i]){let e,t=a[i];for(;e=i+"_"+t,t++,o.has(e););o.add(e),s[r]=e,a[i]++,n=!0,(D=null===D?{}:D)[e]=i}else a[i]=1,s[r]=i;o.add(i)}n&&console.warn("Duplicate headers found and renamed."),L=!0}return{data:h,errors:u,meta:{delimiter:S,linebreak:O,aborted:M,truncated:!!e,cursor:f+(t||0),renamedHeaders:D}}}function R(){I(w()),h=[],u=[]}},this.abort=function(){M=!0},this.getCharIndex=function(){return z}}function g(e){var t=e.data,i=o[t.workerId],r=!1;if(t.error)i.userError(t.error,t.file);else if(t.results&&t.results.data){var n={abort:function(){r=!0,_(t.workerId,{data:[],errors:[],meta:{aborted:!0}})},pause:m,resume:m};if(U(i.userStep)){for(var s=0;s<t.results.data.length&&(i.userStep({data:t.results.data[s],errors:t.results.errors,meta:t.results.meta},n),!r);s++);delete t.results}else U(i.userChunk)&&(i.userChunk(t.results,n,t.file),delete t.results)}t.finished&&!r&&_(t.workerId,t.results)}function _(e,t){var i=o[e];U(i.userComplete)&&i.userComplete(t),i.terminate(),delete o[e]}function m(){throw new Error("Not implemented.")}function b(e){if("object"!=typeof e||null===e)return e;var t,i=Array.isArray(e)?[]:{};for(t in e)i[t]=b(e[t]);return i}function y(e,t){return function(){e.apply(t,arguments)}}function U(e){return"function"==typeof e}return v.parse=function(e,t){var i=(t=t||{}).dynamicTyping||!1;U(i)&&(t.dynamicTypingFunction=i,i={});if(t.dynamicTyping=i,t.transform=!!U(t.transform)&&t.transform,!t.worker||!v.WORKERS_SUPPORTED)return i=null,v.NODE_STREAM_INPUT,"string"==typeof e?(e=(e=>65279!==e.charCodeAt(0)?e:e.slice(1))(e),i=new(t.download?f:c)(t)):!0===e.readable&&U(e.read)&&U(e.on)?i=new p(t):(n.File&&e instanceof File||e instanceof Object)&&(i=new l(t)),i.stream(e);(i=(()=>{var e;return!!v.WORKERS_SUPPORTED&&(e=(()=>{var e=n.URL||n.webkitURL||null,t=r.toString();return v.BLOB_URL||(v.BLOB_URL=e.createObjectURL(new Blob(["var global = (function() { if (typeof self !== 'undefined') { return self; } if (typeof window !== 'undefined') { return window; } if (typeof global !== 'undefined') { return global; } return {}; })(); global.IS_PAPA_WORKER=true; ","(",t,")();"],{type:"text/javascript"})))})(),(e=new n.Worker(e)).onmessage=g,e.id=h++,o[e.id]=e)})()).userStep=t.step,i.userChunk=t.chunk,i.userComplete=t.complete,i.userError=t.error,t.step=U(t.step),t.chunk=U(t.chunk),t.complete=U(t.complete),t.error=U(t.error),delete t.worker,i.postMessage({input:e,config:t,workerId:i.id})},v.unparse=function(e,t){var n=!1,_=!0,m=",",y="\r\n",s='"',a=s+s,i=!1,r=null,o=!1,h=((()=>{if("object"==typeof t){if("string"!=typeof t.delimiter||v.BAD_DELIMITERS.filter(function(e){return-1!==t.delimiter.indexOf(e)}).length||(m=t.delimiter),"boolean"!=typeof t.quotes&&"function"!=typeof t.quotes&&!Array.isArray(t.quotes)||(n=t.quotes),"boolean"!=typeof t.skipEmptyLines&&"string"!=typeof t.skipEmptyLines||(i=t.skipEmptyLines),"string"==typeof t.newline&&(y=t.newline),"string"==typeof t.quoteChar&&(s=t.quoteChar),"boolean"==typeof t.header&&(_=t.header),Array.isArray(t.columns)){if(0===t.columns.length)throw new Error("Option columns is empty");r=t.columns}void 0!==t.escapeChar&&(a=t.escapeChar+s),t.escapeFormulae instanceof RegExp?o=t.escapeFormulae:"boolean"==typeof t.escapeFormulae&&t.escapeFormulae&&(o=/^[=+\-@\t\r].*$/)}})(),new RegExp(P(s),"g"));"string"==typeof e&&(e=JSON.parse(e));if(Array.isArray(e)){if(!e.length||Array.isArray(e[0]))return u(null,e,i);if("object"==typeof e[0])return u(r||Object.keys(e[0]),e,i)}else if("object"==typeof e)return"string"==typeof e.data&&(e.data=JSON.parse(e.data)),Array.isArray(e.data)&&(e.fields||(e.fields=e.meta&&e.meta.fields||r),e.fields||(e.fields=Array.isArray(e.data[0])?e.fields:"object"==typeof e.data[0]?Object.keys(e.data[0]):[]),Array.isArray(e.data[0])||"object"==typeof e.data[0]||(e.data=[e.data])),u(e.fields||[],e.data||[],i);throw new Error("Unable to serialize unrecognized input");function u(e,t,i){var r="",n=("string"==typeof e&&(e=JSON.parse(e)),"string"==typeof t&&(t=JSON.parse(t)),Array.isArray(e)&&0<e.length),s=!Array.isArray(t[0]);if(n&&_){for(var a=0;a<e.length;a++)0<a&&(r+=m),r+=k(e[a],a);0<t.length&&(r+=y)}for(var o=0;o<t.length;o++){var h=(n?e:t[o]).length,u=!1,d=n?0===Object.keys(t[o]).length:0===t[o].length;if(i&&!n&&(u="greedy"===i?""===t[o].join("").trim():1===t[o].length&&0===t[o][0].length),"greedy"===i&&n){for(var f=[],l=0;l<h;l++){var c=s?e[l]:l;f.push(t[o][c])}u=""===f.join("").trim()}if(!u){for(var p=0;p<h;p++){0<p&&!d&&(r+=m);var g=n&&s?e[p]:p;r+=k(t[o][g],p)}o<t.length-1&&(!i||0<h&&!d)&&(r+=y)}}return r}function k(e,t){var i,r;return null==e?"":e.constructor===Date?JSON.stringify(e).slice(1,25):(r=!1,o&&"string"==typeof e&&o.test(e)&&(e="'"+e,r=!0),i=e.toString().replace(h,a),(r=r||!0===n||"function"==typeof n&&n(e,t)||Array.isArray(n)&&n[t]||((e,t)=>{for(var i=0;i<t.length;i++)if(-1<e.indexOf(t[i]))return!0;return!1})(i,v.BAD_DELIMITERS)||-1<i.indexOf(m)||" "===i.charAt(0)||" "===i.charAt(i.length-1))?s+i+s:i)}},v.RECORD_SEP=String.fromCharCode(30),v.UNIT_SEP=String.fromCharCode(31),v.BYTE_ORDER_MARK="\ufeff",v.BAD_DELIMITERS=["\r","\n",'"',v.BYTE_ORDER_MARK],v.WORKERS_SUPPORTED=!s&&!!n.Worker,v.NODE_STREAM_INPUT=1,v.LocalChunkSize=10485760,v.RemoteChunkSize=5242880,v.DefaultDelimiter=",",v.Parser=E,v.ParserHandle=i,v.NetworkStreamer=f,v.FileStreamer=l,v.StringStreamer=c,v.ReadableStreamStreamer=p,n.jQuery&&((d=n.jQuery).fn.parse=function(o){var i=o.config||{},h=[];return this.each(function(e){if(!("INPUT"===d(this).prop("tagName").toUpperCase()&&"file"===d(this).attr("type").toLowerCase()&&n.FileReader)||!this.files||0===this.files.length)return!0;for(var t=0;t<this.files.length;t++)h.push({file:this.files[t],inputElem:this,instanceConfig:d.extend({},i)})}),e(),this;function e(){if(0===h.length)U(o.complete)&&o.complete();else{var e,t,i,r,n=h[0];if(U(o.before)){var s=o.before(n.file,n.inputElem);if("object"==typeof s){if("abort"===s.action)return e="AbortError",t=n.file,i=n.inputElem,r=s.reason,void(U(o.error)&&o.error({name:e},t,i,r));if("skip"===s.action)return void u();"object"==typeof s.config&&(n.instanceConfig=d.extend(n.instanceConfig,s.config))}else if("skip"===s)return void u()}var a=n.instanceConfig.complete;n.instanceConfig.complete=function(e){U(a)&&a(e,n.file,n.inputElem),u()},v.parse(n.file,n.instanceConfig)}}function u(){h.splice(0,1),e()}}),a&&(n.onmessage=function(e){e=e.data;void 0===v.WORKER_ID&&e&&(v.WORKER_ID=e.workerId);"string"==typeof e.input?n.postMessage({workerId:v.WORKER_ID,results:v.parse(e.input,e.config),finished:!0}):(n.File&&e.input instanceof File||e.input instanceof Object)&&(e=v.parse(e.input,e.config))&&n.postMessage({workerId:v.WORKER_ID,results:e,finished:!0})}),(f.prototype=Object.create(u.prototype)).constructor=f,(l.prototype=Object.create(u.prototype)).constructor=l,(c.prototype=Object.create(c.prototype)).constructor=c,(p.prototype=Object.create(u.prototype)).constructor=p,v});
\ No newline at end of file
+((e,t)=>{"function"==typeof define&&define.amd?define([],t):"object"==typeof module&&"undefined"!=typeof exports?module.exports=t():e.Papa=t()})(this,function i(){var n="undefined"!=typeof self?self:"undefined"!=typeof window?window:void 0!==n?n:{};var f,s=!n.document&&!!n.postMessage,a=n.IS_PAPA_WORKER||!1,o={},h=0,v={};function z(e){return 65279===e.charCodeAt(0)?e.slice(1):e}function b(e){return e&&"object"==typeof e&&e.constructor!==Date}function u(e){return""===e||/[.[\]"]/.test(e)}function d(e){for(var t,r,i="",n=0;n<e.length;n++)"key"===e[n].type&&0<n&&!u(e[n].key)&&(i+="."),i+=(r=void 0,"index"===(t=e[n]).type?"["+t.index+"]":(r=t.key.replace(/"/g,'\\"'),u(t.key)?'["'+r+'"]':t.key));return i}function w(e){var t=[],r=0,i=!0;if("string"!=typeof e||0===e.length)return{error:!0,parts:[{type:"key",key:e}]};for(;r<e.length;)if("."===e[r]){if(i)return{error:!0,parts:[{type:"key",key:e}]};i=!0,r++}else{if("["===e[r])if('"'===e[r+1]){var n="";for(r+=2;r<e.length;)if("\\"===e[r]&&'"'===e[r+1])n+='"',r+=2;else{if('"'===e[r])break;n+=e[r++]}if('"'!==e[r]||"]"!==e[r+1])return{error:!0,parts:[{type:"key",key:e}]};t.push({type:"key",key:n}),r+=2}else{for(var s=++r;r<e.length&&"]"!==e[r];)r++;if("]"!==e[r]||s===r)return{error:!0,parts:[{type:"key",key:e}]};s=e.slice(s,r);if(!/^0$|^[1-9][0-9]*$/.test(s))return{error:!0,parts:[{type:"key",key:e}]};t.push({type:"index",index:parseInt(s)}),r++}else{for(s=r;r<e.length&&"."!==e[r]&&"["!==e[r]&&"]"!==e[r];)r++;if(s===r||"]"===e[r])return{error:!0,parts:[{type:"key",key:e}]};t.push({type:"key",key:e.slice(s,r)})}i=!1}return i?{error:!0,parts:[{type:"key",key:e}]}:{parts:t}}function c(e,t,r){e=d(e);Object.prototype.hasOwnProperty.call(r,e)||(r[e]=!0,t.push(e))}function E(e,t){for(var r=e.length;r<t;r++)e[r]=null}function l(e){this._handle=null,this._finished=!1,this._completed=!1,this._halted=!1,this._input=null,this._baseIndex=0,this._partialLine="",this._rowCount=0,this._start=0,this._nextChunk=null,this.isFirstChunk=!0,this._completeResults={data:[],errors:[],meta:{}},function(e){var t=x(e);t.chunkSize=parseInt(t.chunkSize),e.step||e.chunk||(t.chunkSize=null);this._handle=new r(t),(this._handle.streamer=this)._config=t}.call(this,e),this.parseChunk=function(t,e){var r=parseInt(this._config.skipFirstNLines)||0;if(this.isFirstChunk&&0<r){let e=this._config.newline;e||(i=this._config.quoteChar||'"',e=this._handle.guessLineEndings(t,i)),t=[...t.split(e).slice(r)].join(e)}this.isFirstChunk&&U(this._config.beforeFirstChunk)&&void 0!==(i=this._config.beforeFirstChunk(t))&&(t=i),this.isFirstChunk=!1,this._halted=!1;var r=this._partialLine+t,i=(this._partialLine="",this._handle.parse(r,this._baseIndex,!this._finished));if(!this._handle.paused()&&!this._handle.aborted()){t=i.meta.cursor,r=(this._finished||(this._partialLine=r.substring(t-this._baseIndex),this._baseIndex=t),i&&i.data&&(this._rowCount+=i.data.length),this._finished||this._config.preview&&this._rowCount>=this._config.preview);if(a)n.postMessage({results:i,workerId:v.WORKER_ID,finished:r});else if(U(this._config.chunk)&&!e){if(this._config.chunk(i,this._handle),this._handle.paused()||this._handle.aborted())return void(this._halted=!0);this._completeResults=i=void 0}return this._config.step||this._config.chunk||(this._completeResults.data=this._completeResults.data.concat(i.data),this._completeResults.errors=this._completeResults.errors.concat(i.errors),this._completeResults.meta=i.meta),this._completed||!r||!U(this._config.complete)||i&&i.meta.aborted||(this._config.complete(this._completeResults,this._input),this._completed=!0),r||i&&i.meta.paused||this._nextChunk(),i}this._halted=!0},this._sendError=function(e){U(this._config.error)?this._config.error(e):a&&this._config.error&&n.postMessage({workerId:v.WORKER_ID,error:e,finished:!1})}}function p(e){var i;(e=e||{}).chunkSize||(e.chunkSize=v.RemoteChunkSize),l.call(this,e),this._nextChunk=s?function(){this._readChunk(),this._chunkLoaded()}:function(){this._readChunk()},this.stream=function(e){this._input=e,this._nextChunk()},this._readChunk=function(){if(this._finished)this._chunkLoaded();else{if(i=new XMLHttpRequest,this._config.withCredentials&&(i.withCredentials=this._config.withCredentials),s||(i.onload=O(this._chunkLoaded,this),i.onerror=O(this._chunkError,this)),i.open(this._config.downloadRequestBody?"POST":"GET",this._input,!s),this._config.downloadRequestHeaders){var e,t=this._config.downloadRequestHeaders;for(e in t)i.setRequestHeader(e,t[e])}var r;this._config.chunkSize&&(r=this._start+this._config.chunkSize-1,i.setRequestHeader("Range","bytes="+this._start+"-"+r));try{i.send(this._config.downloadRequestBody)}catch(e){this._chunkError(e.message)}s&&0===i.status&&this._chunkError()}},this._chunkLoaded=function(){4===i.readyState&&(i.status<200||400<=i.status?this._chunkError():(this._start+=this._config.chunkSize||i.responseText.length,this._finished=!this._config.chunkSize||this._start>=(e=>null!==(e=e.getResponseHeader("Content-Range"))?parseInt(e.substring(e.lastIndexOf("/")+1)):-1)(i),this.parseChunk(i.responseText)))},this._chunkError=function(e){e=i.statusText||e;this._sendError(new Error(e))}}function g(e){(e=e||{}).chunkSize||(e.chunkSize=v.LocalChunkSize),l.call(this,e);var r,i,n="undefined"!=typeof FileReader;this.stream=function(e){this._input=e,i=e.slice||e.webkitSlice||e.mozSlice,n?((r=new FileReader).onload=O(this._chunkLoaded,this),r.onerror=O(this._chunkError,this)):r=new FileReaderSync,this._nextChunk()},this._nextChunk=function(){this._finished||this._config.preview&&!(this._rowCount<this._config.preview)||this._readChunk()},this._readChunk=function(){var e=this._input,t=(this._config.chunkSize&&(t=Math.min(this._start+this._config.chunkSize,this._input.size),e=i.call(e,this._start,t)),r.readAsText(e,this._config.encoding));n||this._chunkLoaded({target:{result:t}})},this._chunkLoaded=function(e){this._start+=this._config.chunkSize,this._finished=!this._config.chunkSize||this._start>=this._input.size,this.parseChunk(e.target.result)},this._chunkError=function(){this._sendError(r.error)}}function y(e){var r;l.call(this,e=e||{}),this.stream=function(e){return r=e,this._nextChunk()},this._nextChunk=function(){var e,t;if(!this._finished)return e=this._config.chunkSize,r=e?(t=r.substring(0,e),r.substring(e)):(t=r,""),this._finished=!r,this.parseChunk(t)}}function _(e){l.call(this,e=e||{});var t=[],r=!0,i=!1;this.pause=function(){l.prototype.pause.apply(this,arguments),this._input.pause()},this.resume=function(){l.prototype.resume.apply(this,arguments),this._input.resume()},this.stream=function(e){this._input=e,this._input.on("data",this._streamData),this._input.on("end",this._streamEnd),this._input.on("error",this._streamError)},this._checkIsFinished=function(){i&&1===t.length&&(this._finished=!0)},this._nextChunk=function(){this._checkIsFinished(),t.length?this.parseChunk(t.shift()):r=!0},this._streamData=O(function(e){try{t.push("string"==typeof e?e:e.toString(this._config.encoding)),r&&(r=!1,this._checkIsFinished(),this.parseChunk(t.shift()))}catch(e){this._streamError(e)}},this),this._streamError=O(function(e){this._streamCleanUp(),this._sendError(e)},this),this._streamEnd=O(function(){this._streamCleanUp(),i=!0,this._streamData("")},this),this._streamCleanUp=O(function(){this._input.removeListener("data",this._streamData),this._input.removeListener("end",this._streamEnd),this._input.removeListener("error",this._streamError)},this)}function r(_){var n,s,a,t,o=Math.pow(2,53),h=-o,u=/^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/,f=/^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/,r=this,i=0,d=0,l=!1,e=!1,c=[],p={data:[],errors:[],meta:{}};function m(e){return"greedy"===_.skipEmptyLines?""===e.join("").trim():1===e.length&&0===e[0].length}function g(){if(p&&a&&(k("Delimiter","UndetectableDelimiter","Unable to auto-detect delimiting character; defaulted to '"+v.DefaultDelimiter+"'"),a=!1),_.skipEmptyLines&&(p.data=p.data.filter(function(e){return!m(e)})),y()){if(p)if(Array.isArray(p.data[0])){for(var e=0;y()&&e<p.data.length;e++)p.data[e].forEach(t);p.data.splice(0,1)}else p.data.forEach(t);function t(e,t){e=z(e),U(_.transformHeader)&&(e=_.transformHeader(e,t)),c.push(e)}}function r(e,t){for(var r=_.header?{}:[],i=0;i<e.length;i++){var n=i,s=e[i],s=((e,t)=>(e=>(_.dynamicTypingFunction&&void 0===_.dynamicTyping[e]&&(_.dynamicTyping[e]=_.dynamicTypingFunction(e)),!0===(_.dynamicTyping[e]||_.dynamicTyping)))(e)?"true"===t||"TRUE"===t||"false"!==t&&"FALSE"!==t&&((e=>{if(u.test(e)){e=parseFloat(e);if(h<e&&e<o)return 1}})(t)?parseFloat(t):f.test(t)?new Date(t):""===t?null:t):t)(n=_.header?i>=c.length?"__parsed_extra":c[i]:n,s=_.transform?_.transform(s,n):s);"__parsed_extra"===n?(r[n]=r[n]||[],r[n].push(s)):_.nested?((e,t,r,i,n)=>{var s=w(t);if(s.error)i("NestedField","MalformedPath","Malformed path header: "+t,n),e[t]=r;else for(var a=e,o=s.parts,h=0;h<o.length;h++){var u=o[h],f=h===o.length-1,d="index"===u.type?u.index:u.key,l=o[h+1];if(Array.isArray(a)&&"index"!==u.type)return i("NestedField","ContainerConflict","Nested path conflict at header: "+t,n);if(f)return b(a[d])?i("NestedField","ValueConflict","Nested path conflict at header: "+t,n):(Array.isArray(a)&&d>=a.length&&E(a,d),a[d]=r);u="index"===l.type;if(null==a[d]||""===a[d])Array.isArray(a)&&d>=a.length&&E(a,d),a[d]=u?[]:{};else{if(!b(a[d]))return i("NestedField","ValueConflict","Nested path conflict at header: "+t,n);if(Array.isArray(a[d])!==u)return i("NestedField","ContainerConflict","Nested path conflict at header: "+t,n)}a=a[d]}})(r,n,s,k,d+t):r[n]=s}return _.header&&(i>c.length?k("FieldMismatch","TooManyFields","Too many fields: expected "+c.length+" fields but parsed "+i,d+t):i<c.length&&k("FieldMismatch","TooFewFields","Too few fields: expected "+c.length+" fields but parsed "+i,d+t)),r}var i;p&&(_.header||_.dynamicTyping||_.transform)&&(i=1,!p.data.length||Array.isArray(p.data[0])?(p.data=p.data.map(r),i=p.data.length):p.data=r(p.data,0),_.header&&p.meta&&(p.meta.fields=c),d+=i)}function y(){return _.header&&0===c.length}function k(e,t,r,i){e={type:e,code:t,message:r};void 0!==i&&(e.row=i),p.errors.push(e)}U(_.step)&&(t=_.step,_.step=function(e){p=e,y()?g():(g(),0!==p.data.length&&(i+=e.data.length,_.preview&&i>_.preview?s.abort():(p.data=p.data[0],t(p,r))))}),this.parse=function(e,t,r){var i=_.quoteChar||'"',i=(_.newline||(_.newline=this.guessLineEndings(e,i)),a=!1,_.delimiter?U(_.delimiter)&&(_.delimiter=_.delimiter(e),p.meta.delimiter=_.delimiter):((i=((e,t,r,i,n)=>{var s,a,o,h;n=n||[",","\t","|",";",v.RECORD_SEP,v.UNIT_SEP];for(var u=0;u<n.length;u++){for(var f,d=n[u],l=0,c=0,p=0,g=(o=void 0,new C({comments:i,delimiter:d,newline:t,preview:10}).parse(e)),y=0;y<g.data.length;y++)r&&m(g.data[y])?p++:(f=g.data[y].length,c+=f,void 0===o?o=f:0<f&&(l+=Math.abs(f-o),o=f));0<g.data.length&&(c/=g.data.length-p),(void 0===a||l<=a)&&(void 0===h||h<c)&&1.99<c&&(a=l,s=d,h=c)}return{successful:!!(_.delimiter=s),bestDelimiter:s}})(e,_.newline,_.skipEmptyLines,_.comments,_.delimitersToGuess)).successful?_.delimiter=i.bestDelimiter:(a=!0,_.delimiter=v.DefaultDelimiter),p.meta.delimiter=_.delimiter),x(_));return _.preview&&_.header&&i.preview++,n=e,s=new C(i),p=s.parse(n,t,r),g(),l?{meta:{paused:!0}}:p||{meta:{paused:!1}}},this.paused=function(){return l},this.pause=function(){l=!0,s.abort(),n=U(_.chunk)?"":n.substring(s.getCharIndex())},this.resume=function(){r.streamer._halted?(l=!1,r.streamer.parseChunk(n,!0)):setTimeout(r.resume,3)},this.aborted=function(){return e},this.abort=function(){e=!0,s.abort(),p.meta.aborted=!0,U(_.complete)&&_.complete(p),n=""},this.guessLineEndings=function(e,t){e=e.substring(0,1048576);var t=new RegExp(P(t)+"([^]*?)"+P(t),"gm"),r=(e=e.replace(t,"")).split("\r"),t=e.split("\n"),e=1<t.length&&t[0].length<r[0].length;if(1===r.length||e)return"\n";for(var i=0,n=0;n<r.length;n++)"\n"===r[n][0]&&i++;return i>=r.length/2?"\r\n":"\r"}}function P(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function C(R){var x=(R=R||{}).delimiter,O=R.newline,S=R.comments,A=R.step,I=R.preview,T=R.fastMode,D=null,L=!1,F=null==R.quoteChar?'"':R.quoteChar,j=F;if(void 0!==R.escapeChar&&(j=R.escapeChar),("string"!=typeof x||-1<v.BAD_DELIMITERS.indexOf(x))&&(x=","),S===x)throw new Error("Comment character same as delimiter");!0===S?S="#":("string"!=typeof S||-1<v.BAD_DELIMITERS.indexOf(S))&&(S=!1),"\n"!==O&&"\r"!==O&&"\r\n"!==O&&(O="\n");var M=0,N=!1;this.parse=function(r,t,i){if("string"!=typeof r)throw new Error("Input must be a string");var n=r.length,e=x.length,s=O.length,a=S.length,o=U(A),h=[],u=[],f=[],d=M=0;if(!r)return E();if(T||!1!==T&&-1===r.indexOf(F)){for(var l=r.split(O),c=0;c<l.length;c++){if(f=l[c],M+=f.length,c!==l.length-1)M+=O.length;else if(i)return E();if(!S||f.substring(0,a)!==S){if(o){if(h=[],k(f.split(x)),C(),N)return E()}else k(f.split(x));if(I&&I<=c)return h=h.slice(0,I),E(!0)}}return E()}for(var p=r.indexOf(x,M),g=r.indexOf(O,M),y=new RegExp(P(j)+P(F),"g"),_=r.indexOf(F,M);;)if(r[M]===F)for(_=M,M++;;){if(-1===(_=r.indexOf(F,_+1)))return i||u.push({type:"Quotes",code:"MissingQuotes",message:"Quoted field unterminated",row:h.length,index:M}),b();if(_===n-1)return b(r.substring(M,_).replace(y,F));if(F===j&&r[_+1]===j)_++;else if(F===j||0===_||r[_-1]!==j){-1!==p&&p<_+1&&(p=r.indexOf(x,_+1));var m=v(-1===(g=-1!==g&&g<_+1?r.indexOf(O,_+1):g)?p:Math.min(p,g));if(r.substr(_+1+m,e)===x){f.push(r.substring(M,_).replace(y,F)),r[M=_+1+m+e]!==F&&(_=r.indexOf(F,M)),p=r.indexOf(x,M),g=r.indexOf(O,M);break}m=v(g);if(r.substring(_+1+m,_+1+m+s)===O){if(f.push(r.substring(M,_).replace(y,F)),w(_+1+m+s),p=r.indexOf(x,M),_=r.indexOf(F,M),o&&(C(),N))return E();if(I&&h.length>=I)return E(!0);break}u.push({type:"Quotes",code:"InvalidQuotes",message:"Trailing quote on quoted field is malformed",row:h.length,index:M}),_++}}else if(S&&0===f.length&&r.substring(M,M+a)===S){if(-1===g)return E();M=g+s,g=r.indexOf(O,M),p=r.indexOf(x,M)}else if(-1!==p&&(p<g||-1===g))f.push(r.substring(M,p)),M=p+e,p=r.indexOf(x,M);else{if(-1===g)break;if(f.push(r.substring(M,g)),w(g+s),o&&(C(),N))return E();if(I&&h.length>=I)return E(!0)}return b();function k(e){h.push(e),d=M}function v(e){var t=0;return t=-1!==e&&(e=r.substring(_+1,e))&&""===e.trim()?e.length:t}function b(e){return i||(void 0===e&&(e=r.substring(M)),f.push(e),M=n,k(f),o&&C()),E()}function w(e){M=e,k(f),f=[],g=r.indexOf(O,M)}function E(e){if(R.header&&!t&&h.length&&!L){var s=h[0],a=Object.create(null),o=new Set(s);let n=!1;for(let i=0;i<s.length;i++){let r=z(s[i]);if(a[r=U(R.transformHeader)?R.transformHeader(r,i):r]){let e,t=a[r];for(;e=r+"_"+t,t++,o.has(e););o.add(e),s[i]=e,a[r]++,n=!0,(D=null===D?{}:D)[e]=r}else a[r]=1,s[i]=r;o.add(r)}n&&console.warn("Duplicate headers found and renamed."),L=!0}return{data:h,errors:u,meta:{delimiter:x,linebreak:O,aborted:N,truncated:!!e,cursor:d+(t||0),renamedHeaders:D}}}function C(){A(E()),h=[],u=[]}},this.abort=function(){N=!0},this.getCharIndex=function(){return M}}function m(e){var t=e.data,r=o[t.workerId],i=!1;if(t.error)r.userError(t.error,t.file);else if(t.results&&t.results.data){var n={abort:function(){i=!0,k(t.workerId,{data:[],errors:[],meta:{aborted:!0}})},pause:R,resume:R};if(U(r.userStep)){for(var s=0;s<t.results.data.length&&(r.userStep({data:t.results.data[s],errors:t.results.errors,meta:t.results.meta},n),!i);s++);delete t.results}else U(r.userChunk)&&(r.userChunk(t.results,n,t.file),delete t.results)}t.finished&&!i&&k(t.workerId,t.results)}function k(e,t){var r=o[e];U(r.userComplete)&&r.userComplete(t),r.terminate(),delete o[e]}function R(){throw new Error("Not implemented.")}function x(e){if("object"!=typeof e||null===e)return e;var t,r=Array.isArray(e)?[]:{};for(t in e)r[t]=x(e[t]);return r}function O(e,t){return function(){e.apply(t,arguments)}}function U(e){return"function"==typeof e}return v.parse=function(e,t){var r=(t=t||{}).dynamicTyping||!1;U(r)&&(t.dynamicTypingFunction=r,r={});if(t.dynamicTyping=r,t.transform=!!U(t.transform)&&t.transform,!t.worker||!v.WORKERS_SUPPORTED)return r=null,v.NODE_STREAM_INPUT,"string"==typeof e?(e=z(e),r=new(t.download?p:y)(t)):!0===e.readable&&U(e.read)&&U(e.on)?r=new _(t):(n.File&&e instanceof File||e instanceof Object)&&(r=new g(t)),r.stream(e);(r=(()=>{var e;return!!v.WORKERS_SUPPORTED&&(e=(()=>{var e=n.URL||n.webkitURL||null,t=i.toString();return v.BLOB_URL||(v.BLOB_URL=e.createObjectURL(new Blob(["var global = (function() { if (typeof self !== 'undefined') { return self; } if (typeof window !== 'undefined') { return window; } if (typeof global !== 'undefined') { return global; } return {}; })(); global.IS_PAPA_WORKER=true; ","(",t,")();"],{type:"text/javascript"})))})(),(e=new n.Worker(e)).onmessage=m,e.id=h++,o[e.id]=e)})()).userStep=t.step,r.userChunk=t.chunk,r.userComplete=t.complete,r.userError=t.error,t.step=U(t.step),t.chunk=U(t.chunk),t.complete=U(t.complete),t.error=U(t.error),delete t.worker,r.postMessage({input:e,config:t,workerId:r.id})},v.unparse=function(e,t){var s=!1,y=!0,_=",",m="\r\n",a='"',o=a+a,r=!1,i=null,n=!1,h=!1,u=((()=>{if("object"==typeof t){if("string"!=typeof t.delimiter||v.BAD_DELIMITERS.filter(function(e){return-1!==t.delimiter.indexOf(e)}).length||(_=t.delimiter),"boolean"!=typeof t.quotes&&"function"!=typeof t.quotes&&!Array.isArray(t.quotes)||(s=t.quotes),"boolean"!=typeof t.skipEmptyLines&&"string"!=typeof t.skipEmptyLines||(r=t.skipEmptyLines),"string"==typeof t.newline&&(m=t.newline),"string"==typeof t.quoteChar&&(a=t.quoteChar,o=a+a),"boolean"==typeof t.header&&(y=t.header),Array.isArray(t.columns)){if(0===t.columns.length)throw new Error("Option columns is empty");i=t.columns}"boolean"==typeof t.nested&&(n=t.nested),void 0!==t.escapeChar&&(o=t.escapeChar+a),t.escapeFormulae instanceof RegExp?h=t.escapeFormulae:"boolean"==typeof t.escapeFormulae&&t.escapeFormulae&&(h=/^[=+\-@\t\r].*$/)}})(),new RegExp(P(a),"g"));"string"==typeof e&&(e=JSON.parse(e));if(Array.isArray(e)){if(!e.length||Array.isArray(e[0]))return f(null,e,r);if("object"==typeof e[0])return n?d(i||l(e),e,r):f(i||Object.keys(e[0]),e,r)}else if("object"==typeof e)return"string"==typeof e.data&&(e.data=JSON.parse(e.data)),Array.isArray(e.data)&&(e.fields||(e.fields=e.meta&&e.meta.fields||i),e.fields||(n&&!Array.isArray(e.data[0])&&"object"==typeof e.data[0]?e.fields=l(e.data):Array.isArray(e.data[0])?e.fields=e.fields:"object"==typeof e.data[0]?e.fields=Object.keys(e.data[0]):e.fields=[]),Array.isArray(e.data[0])||"object"==typeof e.data[0]||(e.data=[e.data])),(n&&e.data&&!Array.isArray(e.data[0])?d:f)(e.fields||[],e.data||[],r);throw new Error("Unable to serialize unrecognized input");function f(e,t,r){var i="",n=("string"==typeof e&&(e=JSON.parse(e)),"string"==typeof t&&(t=JSON.parse(t)),Array.isArray(e)&&0<e.length),s=!Array.isArray(t[0]);if(n&&y){for(var a=0;a<e.length;a++)0<a&&(i+=_),i+=k(e[a],a);0<t.length&&(i+=m)}for(var o=0;o<t.length;o++){var h=(n?e:t[o]).length,u=!1,f=n?0===Object.keys(t[o]).length:0===t[o].length;if(r&&!n&&(u="greedy"===r?""===t[o].join("").trim():1===t[o].length&&0===t[o][0].length),"greedy"===r&&n){for(var d=[],l=0;l<h;l++){var c=s?e[l]:l;d.push(t[o][c])}u=""===d.join("").trim()}if(!u){for(var p=0;p<h;p++){0<p&&!f&&(i+=_);var g=n&&s?e[p]:p;i+=k(t[o][g],p)}o<t.length-1&&(!r||0<h&&!f)&&(i+=m)}}return i}function d(e,t,r){for(var i=[],n=e.map(function(e){var t=w(e);return t.error?[{type:"key",key:e}]:t.parts}),s=0;s<t.length;s++){for(var a={},o=0;o<e.length;o++)a[e[o]]=((e,t)=>{for(var r=0;r<t.length;r++){if(null==e)return;e="index"===t[r].type?e[t[r].index]:e[t[r].key]}return b(e)?JSON.stringify(e):e})(t[s],n[o]);i.push(a)}return f(e,i,r)}function l(e){for(var t=[],r={},i=0;i<e.length;i++)!function e(t,r,i,n,s){if(b(t)){if(-1!==s.indexOf(t))throw new Error("Circular reference detected");if(s.push(t),Array.isArray(t)){0===t.length&&r.length&&c(r,i,n);for(var a=0;a<t.length;a++)e(Object.prototype.hasOwnProperty.call(t,a)?t[a]:null,r.concat([{type:"index",index:a}]),i,n,s)}else{var o=Object.keys(t);0===o.length&&r.length&&c(r,i,n);for(var h=0;h<o.length;h++)e(t[o[h]],r.concat([{type:"key",key:o[h]}]),i,n,s)}return void s.pop()}c(r,i,n)}(e[i],[],t,r,[]);return t}function k(e,t){var r,i,n;return null==e?"":e.constructor===Date?JSON.stringify(e).slice(1,25):(n=!1,h&&"string"==typeof e&&h.test(e)&&(e="'"+e,n=!0),i=(r=e.toString()).replace(u,o),(n=n||!0===s||"function"==typeof s&&s(e,t)||Array.isArray(s)&&s[t]||((e,t)=>{for(var r=0;r<t.length;r++)if(-1<e.indexOf(t[r]))return!0;return!1})(i,v.BAD_DELIMITERS)||-1<i.indexOf(_)||-1<r.indexOf(a)||" "===i.charAt(0)||" "===i.charAt(i.length-1))?a+i+a:i)}},v.RECORD_SEP=String.fromCharCode(30),v.UNIT_SEP=String.fromCharCode(31),v.BYTE_ORDER_MARK="\ufeff",v.BAD_DELIMITERS=["\r","\n",'"',v.BYTE_ORDER_MARK],v.WORKERS_SUPPORTED=!s&&!!n.Worker,v.NODE_STREAM_INPUT=1,v.LocalChunkSize=10485760,v.RemoteChunkSize=5242880,v.DefaultDelimiter=",",v.Parser=C,v.ParserHandle=r,v.NetworkStreamer=p,v.FileStreamer=g,v.StringStreamer=y,v.ReadableStreamStreamer=_,n.jQuery&&((f=n.jQuery).fn.parse=function(o){var r=o.config||{},h=[];return this.each(function(e){if(!("INPUT"===f(this).prop("tagName").toUpperCase()&&"file"===f(this).attr("type").toLowerCase()&&n.FileReader)||!this.files||0===this.files.length)return!0;for(var t=0;t<this.files.length;t++)h.push({file:this.files[t],inputElem:this,instanceConfig:f.extend({},r)})}),e(),this;function e(){if(0===h.length)U(o.complete)&&o.complete();else{var e,t,r,i,n=h[0];if(U(o.before)){var s=o.before(n.file,n.inputElem);if("object"==typeof s){if("abort"===s.action)return e="AbortError",t=n.file,r=n.inputElem,i=s.reason,void(U(o.error)&&o.error({name:e},t,r,i));if("skip"===s.action)return void u();"object"==typeof s.config&&(n.instanceConfig=f.extend(n.instanceConfig,s.config))}else if("skip"===s)return void u()}var a=n.instanceConfig.complete;n.instanceConfig.complete=function(e){U(a)&&a(e,n.file,n.inputElem),u()},v.parse(n.file,n.instanceConfig)}}function u(){h.splice(0,1),e()}}),a&&(n.onmessage=function(e){e=e.data;void 0===v.WORKER_ID&&e&&(v.WORKER_ID=e.workerId);"string"==typeof e.input?n.postMessage({workerId:v.WORKER_ID,results:v.parse(e.input,e.config),finished:!0}):(n.File&&e.input instanceof File||e.input instanceof Object)&&(e=v.parse(e.input,e.config))&&n.postMessage({workerId:v.WORKER_ID,results:e,finished:!0})}),(p.prototype=Object.create(l.prototype)).constructor=p,(g.prototype=Object.create(l.prototype)).constructor=g,(y.prototype=Object.create(y.prototype)).constructor=y,(_.prototype=Object.create(l.prototype)).constructor=_,v});
\ No newline at end of file
diff --git a/tests/test-cases.js b/tests/test-cases.js
index 321bbc2..f410e62 100644
--- a/tests/test-cases.js
+++ b/tests/test-cases.js
@@ -1573,6 +1573,71 @@ var PARSE_TESTS = [
 			errors: [],
 		}
 	},
+	{
+		description: "Nested header paths rebuild objects and arrays",
+		input: 'id,user.name,tags[0],tags[1],["a.b"]["c]"]\n1,Ann,x,y,2',
+		config: { header: true, nested: true, dynamicTyping: true },
+		expected: {
+			data: [{id: 1, user: {name: 'Ann'}, tags: ['x', 'y'], 'a.b': {'c]': 2}}],
+			errors: []
+		}
+	},
+	{
+		description: "Nested header paths fill sparse array gaps with null",
+		input: 'arr[2]\nx',
+		config: { header: true, nested: true, delimiter: ',' },
+		expected: {
+			data: [{arr: [null, null, 'x']}],
+			errors: []
+		}
+	},
+	{
+		description: "Malformed nested header path is reported and kept literally",
+		input: 'a..b,x\n1,2',
+		config: { header: true, nested: true },
+		expected: {
+			data: [{'a..b': '1', x: '2'}],
+			errors: [{
+				type: 'NestedField',
+				code: 'MalformedPath',
+				message: 'Malformed path header: a..b',
+				row: 0
+			}]
+		}
+	},
+	{
+		description: "Nested path conflicts are reported while preserving unrelated fields",
+		input: 'a,a.b,b.c,b,d\n1,2,3,4,5',
+		config: { header: true, nested: true },
+		expected: {
+			data: [{a: '1', b: {c: '3'}, d: '5'}],
+			errors: [{
+				type: 'NestedField',
+				code: 'ValueConflict',
+				message: 'Nested path conflict at header: a.b',
+				row: 0
+			}, {
+				type: 'NestedField',
+				code: 'ValueConflict',
+				message: 'Nested path conflict at header: b',
+				row: 0
+			}]
+		}
+	},
+	{
+		description: "Nested array vs object conflict keeps the first container",
+		input: 'a[0],a.b,x\n1,2,3',
+		config: { header: true, nested: true },
+		expected: {
+			data: [{a: ['1'], x: '3'}],
+			errors: [{
+				type: 'NestedField',
+				code: 'ContainerConflict',
+				message: 'Nested path conflict at header: a.b',
+				row: 0
+			}]
+		}
+	},
 	{
 		description: "Parsing with skipEmptyLines set to 'greedy'",
 		notes: "Must parse correctly without lines with no content",
@@ -1813,6 +1878,18 @@ describe('Parse Async Tests', function() {
 
 // Tests for Papa.unparse() function (JSON to CSV)
 var UNPARSE_TESTS = [
+	{
+		description: "Nested option flattens objects and arrays into path headers",
+		input: [{id: 1, user: {name: 'Ann'}, tags: ['x', 'y'], 'a.b': {'c]': 2}}, {user: {age: 3}, tags: ['z']}],
+		config: {nested: true},
+		expected: 'id,user.name,tags[0],tags[1],"[""a.b""][""c]""]",user.age\r\n1,Ann,x,y,2,\r\n,,z,,,3'
+	},
+	{
+		description: "Nested option respects columns",
+		input: [{id: 1, user: {name: 'Ann'}, tags: ['x']}],
+		config: {nested: true, columns: ['tags[0]', 'user.name']},
+		expected: 'tags[0],user.name\r\nx,Ann'
+	},
 	{
 		description: "A simple row",
 		notes: "Comma should be default delimiter",
@@ -2147,6 +2224,15 @@ describe('Unparse Tests', function() {
 	for (var i = 0; i < UNPARSE_TESTS.length; i++) {
 		generateTest(UNPARSE_TESTS[i]);
 	}
+
+	it('Nested unparse reports circular references', function() {
+		var row = {id: 1};
+		row.self = row;
+
+		assert.throws(function() {
+			Papa.unparse([row], {nested: true});
+		}, /Circular reference/);
+	});
 });
 
 

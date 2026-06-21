diff --git a/docs/docs.html b/docs/docs.html
index ac39363..4a0e519 100644
--- a/docs/docs.html
+++ b/docs/docs.html
@@ -260,7 +260,8 @@
 	header: true,
 	newline: "\r\n",
 	skipEmptyLines: false, //other option is 'greedy', meaning skip delimiters, quotes, and whitespace.
-	columns: null //or array of strings
+	columns: null, //or array of strings
+	nested: false
 }
 					</code></pre>
 				</div>
@@ -338,6 +339,14 @@
 									If <code>data</code> is an array of objects this option can be used to manually specify the keys (columns) you expect in the objects. If not set the keys of the first objects are used as column.
 								</td>
 							</tr>
+							<tr>
+								<td>
+									<code>nested</code>
+								</td>
+								<td>
+									If <code>true</code>, nested objects and arrays are flattened into path headers. Object keys are joined with dots and array elements use bracketed indices, such as <code>user.name</code> and <code>items[0]</code>. Keys containing <code>.</code>, <code>[</code>, <code>]</code>, or <code>&quot;</code> are written as quoted bracket segments. Columns are unioned across rows in first-seen order unless <code>columns</code> is provided. Circular references throw an error.
+								</td>
+							</tr>
 							<tr>
 								<td>
 									<code>escapeFormulae</code>
@@ -451,7 +460,8 @@ var csv = Papa.unparse({
 	withCredentials: undefined,
 	transform: undefined,
 	delimitersToGuess: [',', '\t', '|', ';', <a href="#readonly">Papa.RECORD_SEP</a>, <a href="#readonly">Papa.UNIT_SEP</a>],
-	skipFirstNLines: 0
+	skipFirstNLines: 0,
+	nested: false
 }</code></pre>
 					</div>
 					<div class="clear"></div>
@@ -507,6 +517,14 @@ var csv = Papa.unparse({
 									Warning: Duplicated field names will be automatically renamed to avoid values in previous fields having the same name to be overwritten. Renamed fields with original (or transformed by <code>transformHeader</code>) are stored in <code>ParseResult.meta.renamedHeaders</code>
 								</td>
 							</tr>
+							<tr>
+								<td>
+									<code>nested</code>
+								</td>
+								<td>
+									If <code>true</code> with <code>header</code>, field names are interpreted as nested paths and rows are rebuilt into objects and arrays. Dot segments address object keys, bracketed numeric segments address array indices, and quoted bracket segments address literal keys containing path characters. Malformed path headers are reported and kept as literal keys; conflicting paths are reported while preserving unrelated fields.
+								</td>
+							</tr>
 							<tr>
 								<td>
 									<code>transformHeader</code>
diff --git a/papaparse.js b/papaparse.js
index b98897a..753abdd 100755
--- a/papaparse.js
+++ b/papaparse.js
@@ -292,6 +292,9 @@ License: MIT
 		/** whether to prevent outputting cells that can be parsed as formulae by spreadsheet software (Excel and LibreOffice) */
 		var _escapeFormulae = false;
 
+		/** whether nested objects and arrays should be flattened into path columns */
+		var _nested = false;
+
 		unpackConfig();
 
 		var quoteCharRegex = new RegExp(escapeRegExp(_quoteChar), 'g');
@@ -304,7 +307,9 @@ License: MIT
 			if (!_input.length || Array.isArray(_input[0]))
 				return serialize(null, _input, _skipEmptyLines);
 			else if (typeof _input[0] === 'object')
-				return serialize(_columns || Object.keys(_input[0]), _input, _skipEmptyLines);
+				return _nested
+					? serializeNested(_columns, _input, _skipEmptyLines)
+					: serialize(_columns || Object.keys(_input[0]), _input, _skipEmptyLines);
 		}
 		else if (typeof _input === 'object')
 		{
@@ -320,13 +325,17 @@ License: MIT
 					_input.fields =  Array.isArray(_input.data[0])
 						? _input.fields
 						: typeof _input.data[0] === 'object'
-							? Object.keys(_input.data[0])
+							? (_nested ? [] : Object.keys(_input.data[0]))
 							: [];
 
 				if (!(Array.isArray(_input.data[0])) && typeof _input.data[0] !== 'object')
 					_input.data = [_input.data];	// handles input like [1,2,3] or ['asdf']
 			}
 
+			if (_nested && Array.isArray(_input.data) && !Array.isArray(_input.data[0])
+				&& (!_input.data.length || typeof _input.data[0] === 'object'))
+				return serializeNested(_input.fields || [], _input.data || [], _skipEmptyLines);
+
 			return serialize(_input.fields || [], _input.data || [], _skipEmptyLines);
 		}
 
@@ -372,6 +381,9 @@ License: MIT
 				_columns = _config.columns;
 			}
 
+			if (typeof _config.nested === 'boolean')
+				_nested = _config.nested;
+
 			if (_config.escapeChar !== undefined) {
 				_escapedQuote = _config.escapeChar + _quoteChar;
 			}
@@ -383,6 +395,65 @@ License: MIT
 			}
 		}
 
+		function serializeNested(fields, data, skipEmptyLines)
+		{
+			var nestedData = prepareNestedData(fields, data);
+			return serialize(nestedData.fields, nestedData.data, skipEmptyLines);
+		}
+
+		function prepareNestedData(fields, data)
+		{
+			if (typeof fields === 'string')
+				fields = JSON.parse(fields);
+			if (typeof data === 'string')
+				data = JSON.parse(data);
+
+			var hasFields = Array.isArray(fields) && fields.length > 0;
+			var nestedFields = hasFields ? fields : [];
+			var fieldMap = Object.create(null);
+			var flattenedData = [];
+
+			if (hasFields)
+			{
+				for (var fieldIndex = 0; fieldIndex < nestedFields.length; fieldIndex++)
+					fieldMap[nestedFields[fieldIndex]] = true;
+			}
+
+			for (var rowIndex = 0; rowIndex < data.length; rowIndex++)
+			{
+				if (hasFields)
+					flattenedData.push(flattenNestedRowWithFields(data[rowIndex], nestedFields));
+				else
+				{
+					var flattenedRow = flattenNestedRow(data[rowIndex]);
+					flattenedData.push(flattenedRow.row);
+
+					for (var rowFieldIndex = 0; rowFieldIndex < flattenedRow.fields.length; rowFieldIndex++)
+					{
+						var field = flattenedRow.fields[rowFieldIndex];
+						if (!fieldMap[field])
+						{
+							fieldMap[field] = true;
+							nestedFields.push(field);
+						}
+					}
+				}
+			}
+
+			return { fields: nestedFields, data: flattenedData };
+		}
+
+		function flattenNestedRowWithFields(row, fields)
+		{
+			var flattenedRow = {};
+			for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex++)
+			{
+				var field = fields[fieldIndex];
+				flattenedRow[field] = getNestedPathValue(row, field);
+			}
+			return flattenedRow;
+		}
+
 		/** The double for loop that iterates the data and writes out a CSV string including header row */
 		function serialize(fields, data, skipEmptyLines)
 		{
@@ -487,6 +558,353 @@ License: MIT
 		}
 	}
 
+	function flattenNestedRow(row)
+	{
+		var flattenedRow = {};
+		var fields = [];
+		var stack = [];
+
+		flatten(row, []);
+
+		return { row: flattenedRow, fields: fields };
+
+		function flatten(value, path)
+		{
+			if (isNestedContainer(value))
+			{
+				if (stack.indexOf(value) !== -1)
+					throw new Error('Circular reference detected while flattening nested data');
+
+				stack.push(value);
+				if (Array.isArray(value))
+				{
+					for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex++)
+					{
+						if (Object.prototype.hasOwnProperty.call(value, arrayIndex))
+							flatten(value[arrayIndex], path.concat([{ type: 'array', index: arrayIndex }]));
+					}
+				}
+				else
+				{
+					var keys = Object.keys(value);
+					for (var keyIndex = 0; keyIndex < keys.length; keyIndex++)
+					{
+						var key = keys[keyIndex];
+						flatten(value[key], path.concat([{ type: 'object', key: key }]));
+					}
+				}
+				stack.pop();
+			}
+			else if (path.length > 0)
+			{
+				var field = nestedPathToString(path);
+				flattenedRow[field] = value;
+				fields.push(field);
+			}
+		}
+	}
+
+	function getNestedPathValue(row, header)
+	{
+		var nestedField = parseNestedPathHeader(header);
+		if (!nestedField.valid)
+			return row && row[header];
+
+		var current = row;
+		for (var pathIndex = 0; pathIndex < nestedField.path.length; pathIndex++)
+		{
+			if (!isNestedContainer(current))
+				return undefined;
+
+			var segment = nestedField.path[pathIndex];
+			if (segment.type === 'array')
+			{
+				if (!Array.isArray(current))
+					return undefined;
+				current = current[segment.index];
+			}
+			else
+				current = current[segment.key];
+		}
+
+		return current;
+	}
+
+	function parseNestedPathHeader(header)
+	{
+		header = String(header);
+		if (header === '')
+			return malformedNestedPath(header);
+
+		var path = [];
+		var index = 0;
+		var needsSegment = true;
+
+		while (index < header.length)
+		{
+			var char = header.charAt(index);
+
+			if (char === '.')
+			{
+				if (needsSegment)
+					return malformedNestedPath(header);
+				needsSegment = true;
+				index++;
+				continue;
+			}
+
+			if (char === '[')
+			{
+				var bracketSegment = parseNestedBracketSegment(header, index);
+				if (!bracketSegment.valid)
+					return malformedNestedPath(header);
+				path.push(bracketSegment.segment);
+				index = bracketSegment.index;
+				needsSegment = false;
+				continue;
+			}
+
+			if (!needsSegment)
+				return malformedNestedPath(header);
+
+			var segmentStart = index;
+			while (index < header.length && header.charAt(index) !== '.' && header.charAt(index) !== '[')
+				index++;
+
+			var key = header.slice(segmentStart, index);
+			if (key === '' || key.indexOf(']') !== -1 || key.indexOf('"') !== -1)
+				return malformedNestedPath(header);
+
+			path.push({ type: 'object', key: key });
+			needsSegment = false;
+		}
+
+		if (needsSegment)
+			return malformedNestedPath(header);
+
+		return { valid: true, header: header, path: path };
+	}
+
+	function parseNestedBracketSegment(header, startIndex)
+	{
+		var index = startIndex + 1;
+		if (index >= header.length)
+			return { valid: false };
+
+		if (header.charAt(index) === '"')
+		{
+			index++;
+			var key = '';
+			while (index < header.length)
+			{
+				var char = header.charAt(index);
+				if (char === '\\')
+				{
+					if (index + 1 >= header.length)
+						return { valid: false };
+					key += header.charAt(index + 1);
+					index += 2;
+					continue;
+				}
+
+				if (char === '"')
+				{
+					if (header.charAt(index + 1) !== ']')
+						return { valid: false };
+					return {
+						valid: true,
+						segment: { type: 'object', key: key },
+						index: index + 2
+					};
+				}
+
+				key += char;
+				index++;
+			}
+
+			return { valid: false };
+		}
+
+		var digitStart = index;
+		while (index < header.length && header.charAt(index) >= '0' && header.charAt(index) <= '9')
+			index++;
+
+		if (digitStart === index || header.charAt(index) !== ']')
+			return { valid: false };
+
+		return {
+			valid: true,
+			segment: { type: 'array', index: parseInt(header.slice(digitStart, index)) },
+			index: index + 1
+		};
+	}
+
+	function malformedNestedPath(header)
+	{
+		return {
+			valid: false,
+			header: header,
+			path: [{ type: 'object', key: header }],
+			message: 'Malformed path header: ' + header
+		};
+	}
+
+	function nestedPathToString(path)
+	{
+		var pathString = '';
+		for (var pathIndex = 0; pathIndex < path.length; pathIndex++)
+		{
+			var segment = path[pathIndex];
+			if (segment.type === 'array')
+				pathString += '[' + segment.index + ']';
+			else
+			{
+				var renderedKey = renderNestedObjectKey(segment.key);
+				if (pathString && renderedKey.charAt(0) !== '[')
+					pathString += '.';
+				pathString += renderedKey;
+			}
+		}
+
+		return pathString;
+	}
+
+	function renderNestedObjectKey(key)
+	{
+		key = String(key);
+		if (key === '' || key.indexOf('.') !== -1 || key.indexOf('[') !== -1 || key.indexOf(']') !== -1 || key.indexOf('"') !== -1)
+			return '["' + key.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
+		return key;
+	}
+
+	function applyNestedPathValue(row, nestedField, value, rowIndex, addError)
+	{
+		if (!nestedField || !nestedField.valid)
+		{
+			assignNestedObjectValue(row, nestedField ? nestedField.header : '', value);
+			return;
+		}
+
+		var current = row;
+		for (var pathIndex = 0; pathIndex < nestedField.path.length; pathIndex++)
+		{
+			var segment = nestedField.path[pathIndex];
+			var isLast = pathIndex === nestedField.path.length - 1;
+
+			if (segment.type === 'array')
+			{
+				if (!Array.isArray(current))
+				{
+					reportNestedConflict('ContainerTypeConflict', nestedField.header, nestedPathToString(nestedField.path.slice(0, pathIndex + 1)), rowIndex, addError);
+					return;
+				}
+
+				fillArrayGaps(current, segment.index);
+				if (isLast)
+				{
+					if (isNestedContainer(current[segment.index]))
+					{
+						reportNestedConflict('ContainerValueConflict', nestedField.header, nestedPathToString(nestedField.path.slice(0, pathIndex + 1)), rowIndex, addError);
+						return;
+					}
+					current[segment.index] = value;
+				}
+				else
+				{
+					var arrayContainer = prepareNestedContainer(current[segment.index], nestedField.path[pathIndex + 1], nestedField.header, nestedField.path.slice(0, pathIndex + 1), rowIndex, addError);
+					if (!arrayContainer)
+						return;
+					current[segment.index] = arrayContainer;
+					current = arrayContainer;
+				}
+			}
+			else
+			{
+				if (!isNestedContainer(current) || Array.isArray(current))
+				{
+					reportNestedConflict(Array.isArray(current) ? 'ContainerTypeConflict' : 'ValueContainerConflict', nestedField.header, nestedPathToString(nestedField.path.slice(0, pathIndex + 1)), rowIndex, addError);
+					return;
+				}
+
+				if (isLast)
+				{
+					if (isNestedContainer(current[segment.key]))
+					{
+						reportNestedConflict('ContainerValueConflict', nestedField.header, nestedPathToString(nestedField.path.slice(0, pathIndex + 1)), rowIndex, addError);
+						return;
+					}
+					assignNestedObjectValue(current, segment.key, value);
+				}
+				else
+				{
+					var objectContainer = prepareNestedContainer(current[segment.key], nestedField.path[pathIndex + 1], nestedField.header, nestedField.path.slice(0, pathIndex + 1), rowIndex, addError);
+					if (!objectContainer)
+						return;
+					assignNestedObjectValue(current, segment.key, objectContainer);
+					current = objectContainer;
+				}
+			}
+		}
+	}
+
+	function prepareNestedContainer(currentValue, nextSegment, header, path, rowIndex, addError)
+	{
+		var expectedType = nextSegment.type === 'array' ? 'array' : 'object';
+		if (typeof currentValue === 'undefined' || currentValue === null)
+			return expectedType === 'array' ? [] : {};
+
+		if (!isNestedContainer(currentValue))
+		{
+			reportNestedConflict('ValueContainerConflict', header, nestedPathToString(path), rowIndex, addError);
+			return null;
+		}
+
+		if ((expectedType === 'array' && !Array.isArray(currentValue)) || (expectedType === 'object' && Array.isArray(currentValue)))
+		{
+			reportNestedConflict('ContainerTypeConflict', header, nestedPathToString(path), rowIndex, addError);
+			return null;
+		}
+
+		return currentValue;
+	}
+
+	function fillArrayGaps(array, index)
+	{
+		for (var gapIndex = array.length; gapIndex < index; gapIndex++)
+			array[gapIndex] = null;
+	}
+
+	function reportNestedConflict(code, header, path, rowIndex, addError)
+	{
+		var conflict = code === 'ContainerTypeConflict'
+			? 'array vs object'
+			: code === 'ValueContainerConflict'
+				? 'value used as container'
+				: 'container later as value';
+		addError('Nested', code, 'Nested path conflict for header "' + header + '" at "' + path + '": ' + conflict, rowIndex);
+	}
+
+	function assignNestedObjectValue(object, key, value)
+	{
+		if (key === '__proto__')
+		{
+			Object.defineProperty(object, key, {
+				value: value,
+				enumerable: true,
+				writable: true,
+				configurable: true
+			});
+			return;
+		}
+
+		object[key] = value;
+	}
+
+	function isNestedContainer(value)
+	{
+		return value !== null && typeof value === 'object' && value.constructor !== Date;
+	}
+
 
 	/** ChunkStreamer is the base prototype for various streamer implementations. */
 	function ChunkStreamer(config)
@@ -1045,6 +1463,7 @@ License: MIT
 		var _aborted = false;	// Whether the parser has aborted or not
 		var _delimiterError;	// Temporary state between delimiter detection and processing results
 		var _fields = [];		// Fields are from the header row of the input, if there is one
+		var _nestedFields = [];	// Parsed path fields used when nested parsing is enabled
 		var _results = {		// The last results returned from the parser
 			data: [],
 			errors: [],
@@ -1252,6 +1671,18 @@ License: MIT
 			// if _results.data[0] is not an array, we are in a step where _results.data is the row.
 			else
 				_results.data.forEach(addHeader);
+
+			if (_config.nested)
+			{
+				_nestedFields = [];
+				for (var fieldIndex = 0; fieldIndex < _fields.length; fieldIndex++)
+				{
+					var nestedField = parseNestedPathHeader(_fields[fieldIndex]);
+					_nestedFields.push(nestedField);
+					if (!nestedField.valid)
+						addError('Nested', 'MalformedPath', nestedField.message);
+				}
+			}
 		}
 
 		function shouldApplyDynamicTyping(field) {
@@ -1308,6 +1739,8 @@ License: MIT
 						row[field] = row[field] || [];
 						row[field].push(value);
 					}
+					else if (_config.header && _config.nested)
+						applyNestedPathValue(row, _nestedFields[j], value, _rowCounter + i, addError);
 					else
 						row[field] = value;
 				}
diff --git a/papaparse.min.js b/papaparse.min.js
index f314110..c21369c 100644
--- a/papaparse.min.js
+++ b/papaparse.min.js
@@ -4,4 +4,4 @@ v5.5.3
 https://github.com/mholt/PapaParse
 License: MIT
 */
-((e,t)=>{"function"==typeof define&&define.amd?define([],t):"object"==typeof module&&"undefined"!=typeof exports?module.exports=t():e.Papa=t()})(this,function r(){var n="undefined"!=typeof self?self:"undefined"!=typeof window?window:void 0!==n?n:{};var d,s=!n.document&&!!n.postMessage,a=n.IS_PAPA_WORKER||!1,o={},h=0,v={};function u(e){this._handle=null,this._finished=!1,this._completed=!1,this._halted=!1,this._input=null,this._baseIndex=0,this._partialLine="",this._rowCount=0,this._start=0,this._nextChunk=null,this.isFirstChunk=!0,this._completeResults={data:[],errors:[],meta:{}},function(e){var t=b(e);t.chunkSize=parseInt(t.chunkSize),e.step||e.chunk||(t.chunkSize=null);this._handle=new i(t),(this._handle.streamer=this)._config=t}.call(this,e),this.parseChunk=function(t,e){var i=parseInt(this._config.skipFirstNLines)||0;if(this.isFirstChunk&&0<i){let e=this._config.newline;e||(r=this._config.quoteChar||'"',e=this._handle.guessLineEndings(t,r)),t=[...t.split(e).slice(i)].join(e)}this.isFirstChunk&&U(this._config.beforeFirstChunk)&&void 0!==(r=this._config.beforeFirstChunk(t))&&(t=r),this.isFirstChunk=!1,this._halted=!1;var i=this._partialLine+t,r=(this._partialLine="",this._handle.parse(i,this._baseIndex,!this._finished));if(!this._handle.paused()&&!this._handle.aborted()){t=r.meta.cursor,i=(this._finished||(this._partialLine=i.substring(t-this._baseIndex),this._baseIndex=t),r&&r.data&&(this._rowCount+=r.data.length),this._finished||this._config.preview&&this._rowCount>=this._config.preview);if(a)n.postMessage({results:r,workerId:v.WORKER_ID,finished:i});else if(U(this._config.chunk)&&!e){if(this._config.chunk(r,this._handle),this._handle.paused()||this._handle.aborted())return void(this._halted=!0);this._completeResults=r=void 0}return this._config.step||this._config.chunk||(this._completeResults.data=this._completeResults.data.concat(r.data),this._completeResults.errors=this._completeResults.errors.concat(r.errors),this._completeResults.meta=r.meta),this._completed||!i||!U(this._config.complete)||r&&r.meta.aborted||(this._config.complete(this._completeResults,this._input),this._completed=!0),i||r&&r.meta.paused||this._nextChunk(),r}this._halted=!0},this._sendError=function(e){U(this._config.error)?this._config.error(e):a&&this._config.error&&n.postMessage({workerId:v.WORKER_ID,error:e,finished:!1})}}function f(e){var r;(e=e||{}).chunkSize||(e.chunkSize=v.RemoteChunkSize),u.call(this,e),this._nextChunk=s?function(){this._readChunk(),this._chunkLoaded()}:function(){this._readChunk()},this.stream=function(e){this._input=e,this._nextChunk()},this._readChunk=function(){if(this._finished)this._chunkLoaded();else{if(r=new XMLHttpRequest,this._config.withCredentials&&(r.withCredentials=this._config.withCredentials),s||(r.onload=y(this._chunkLoaded,this),r.onerror=y(this._chunkError,this)),r.open(this._config.downloadRequestBody?"POST":"GET",this._input,!s),this._config.downloadRequestHeaders){var e,t=this._config.downloadRequestHeaders;for(e in t)r.setRequestHeader(e,t[e])}var i;this._config.chunkSize&&(i=this._start+this._config.chunkSize-1,r.setRequestHeader("Range","bytes="+this._start+"-"+i));try{r.send(this._config.downloadRequestBody)}catch(e){this._chunkError(e.message)}s&&0===r.status&&this._chunkError()}},this._chunkLoaded=function(){4===r.readyState&&(r.status<200||400<=r.status?this._chunkError():(this._start+=this._config.chunkSize||r.responseText.length,this._finished=!this._config.chunkSize||this._start>=(e=>null!==(e=e.getResponseHeader("Content-Range"))?parseInt(e.substring(e.lastIndexOf("/")+1)):-1)(r),this.parseChunk(r.responseText)))},this._chunkError=function(e){e=r.statusText||e;this._sendError(new Error(e))}}function l(e){(e=e||{}).chunkSize||(e.chunkSize=v.LocalChunkSize),u.call(this,e);var i,r,n="undefined"!=typeof FileReader;this.stream=function(e){this._input=e,r=e.slice||e.webkitSlice||e.mozSlice,n?((i=new FileReader).onload=y(this._chunkLoaded,this),i.onerror=y(this._chunkError,this)):i=new FileReaderSync,this._nextChunk()},this._nextChunk=function(){this._finished||this._config.preview&&!(this._rowCount<this._config.preview)||this._readChunk()},this._readChunk=function(){var e=this._input,t=(this._config.chunkSize&&(t=Math.min(this._start+this._config.chunkSize,this._input.size),e=r.call(e,this._start,t)),i.readAsText(e,this._config.encoding));n||this._chunkLoaded({target:{result:t}})},this._chunkLoaded=function(e){this._start+=this._config.chunkSize,this._finished=!this._config.chunkSize||this._start>=this._input.size,this.parseChunk(e.target.result)},this._chunkError=function(){this._sendError(i.error)}}function c(e){var i;u.call(this,e=e||{}),this.stream=function(e){return i=e,this._nextChunk()},this._nextChunk=function(){var e,t;if(!this._finished)return e=this._config.chunkSize,i=e?(t=i.substring(0,e),i.substring(e)):(t=i,""),this._finished=!i,this.parseChunk(t)}}function p(e){u.call(this,e=e||{});var t=[],i=!0,r=!1;this.pause=function(){u.prototype.pause.apply(this,arguments),this._input.pause()},this.resume=function(){u.prototype.resume.apply(this,arguments),this._input.resume()},this.stream=function(e){this._input=e,this._input.on("data",this._streamData),this._input.on("end",this._streamEnd),this._input.on("error",this._streamError)},this._checkIsFinished=function(){r&&1===t.length&&(this._finished=!0)},this._nextChunk=function(){this._checkIsFinished(),t.length?this.parseChunk(t.shift()):i=!0},this._streamData=y(function(e){try{t.push("string"==typeof e?e:e.toString(this._config.encoding)),i&&(i=!1,this._checkIsFinished(),this.parseChunk(t.shift()))}catch(e){this._streamError(e)}},this),this._streamError=y(function(e){this._streamCleanUp(),this._sendError(e)},this),this._streamEnd=y(function(){this._streamCleanUp(),r=!0,this._streamData("")},this),this._streamCleanUp=y(function(){this._input.removeListener("data",this._streamData),this._input.removeListener("end",this._streamEnd),this._input.removeListener("error",this._streamError)},this)}function i(m){var n,s,a,t,o=Math.pow(2,53),h=-o,u=/^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/,d=/^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/,i=this,r=0,f=0,l=!1,e=!1,c=[],p={data:[],errors:[],meta:{}};function y(e){return"greedy"===m.skipEmptyLines?""===e.join("").trim():1===e.length&&0===e[0].length}function g(){if(p&&a&&(k("Delimiter","UndetectableDelimiter","Unable to auto-detect delimiting character; defaulted to '"+v.DefaultDelimiter+"'"),a=!1),m.skipEmptyLines&&(p.data=p.data.filter(function(e){return!y(e)})),_()){if(p)if(Array.isArray(p.data[0])){for(var e=0;_()&&e<p.data.length;e++)p.data[e].forEach(t);p.data.splice(0,1)}else p.data.forEach(t);function t(e,t){U(m.transformHeader)&&(e=m.transformHeader(e,t)),c.push(e)}}function i(e,t){for(var i=m.header?{}:[],r=0;r<e.length;r++){var n=r,s=e[r],s=((e,t)=>(e=>(m.dynamicTypingFunction&&void 0===m.dynamicTyping[e]&&(m.dynamicTyping[e]=m.dynamicTypingFunction(e)),!0===(m.dynamicTyping[e]||m.dynamicTyping)))(e)?"true"===t||"TRUE"===t||"false"!==t&&"FALSE"!==t&&((e=>{if(u.test(e)){e=parseFloat(e);if(h<e&&e<o)return 1}})(t)?parseFloat(t):d.test(t)?new Date(t):""===t?null:t):t)(n=m.header?r>=c.length?"__parsed_extra":c[r]:n,s=m.transform?m.transform(s,n):s);"__parsed_extra"===n?(i[n]=i[n]||[],i[n].push(s)):i[n]=s}return m.header&&(r>c.length?k("FieldMismatch","TooManyFields","Too many fields: expected "+c.length+" fields but parsed "+r,f+t):r<c.length&&k("FieldMismatch","TooFewFields","Too few fields: expected "+c.length+" fields but parsed "+r,f+t)),i}var r;p&&(m.header||m.dynamicTyping||m.transform)&&(r=1,!p.data.length||Array.isArray(p.data[0])?(p.data=p.data.map(i),r=p.data.length):p.data=i(p.data,0),m.header&&p.meta&&(p.meta.fields=c),f+=r)}function _(){return m.header&&0===c.length}function k(e,t,i,r){e={type:e,code:t,message:i};void 0!==r&&(e.row=r),p.errors.push(e)}U(m.step)&&(t=m.step,m.step=function(e){p=e,_()?g():(g(),0!==p.data.length&&(r+=e.data.length,m.preview&&r>m.preview?s.abort():(p.data=p.data[0],t(p,i))))}),this.parse=function(e,t,i){var r=m.quoteChar||'"',r=(m.newline||(m.newline=this.guessLineEndings(e,r)),a=!1,m.delimiter?U(m.delimiter)&&(m.delimiter=m.delimiter(e),p.meta.delimiter=m.delimiter):((r=((e,t,i,r,n)=>{var s,a,o,h;n=n||[",","\t","|",";",v.RECORD_SEP,v.UNIT_SEP];for(var u=0;u<n.length;u++){for(var d,f=n[u],l=0,c=0,p=0,g=(o=void 0,new E({comments:r,delimiter:f,newline:t,preview:10}).parse(e)),_=0;_<g.data.length;_++)i&&y(g.data[_])?p++:(d=g.data[_].length,c+=d,void 0===o?o=d:0<d&&(l+=Math.abs(d-o),o=d));0<g.data.length&&(c/=g.data.length-p),(void 0===a||l<=a)&&(void 0===h||h<c)&&1.99<c&&(a=l,s=f,h=c)}return{successful:!!(m.delimiter=s),bestDelimiter:s}})(e,m.newline,m.skipEmptyLines,m.comments,m.delimitersToGuess)).successful?m.delimiter=r.bestDelimiter:(a=!0,m.delimiter=v.DefaultDelimiter),p.meta.delimiter=m.delimiter),b(m));return m.preview&&m.header&&r.preview++,n=e,s=new E(r),p=s.parse(n,t,i),g(),l?{meta:{paused:!0}}:p||{meta:{paused:!1}}},this.paused=function(){return l},this.pause=function(){l=!0,s.abort(),n=U(m.chunk)?"":n.substring(s.getCharIndex())},this.resume=function(){i.streamer._halted?(l=!1,i.streamer.parseChunk(n,!0)):setTimeout(i.resume,3)},this.aborted=function(){return e},this.abort=function(){e=!0,s.abort(),p.meta.aborted=!0,U(m.complete)&&m.complete(p),n=""},this.guessLineEndings=function(e,t){e=e.substring(0,1048576);var t=new RegExp(P(t)+"([^]*?)"+P(t),"gm"),i=(e=e.replace(t,"")).split("\r"),t=e.split("\n"),e=1<t.length&&t[0].length<i[0].length;if(1===i.length||e)return"\n";for(var r=0,n=0;n<i.length;n++)"\n"===i[n][0]&&r++;return r>=i.length/2?"\r\n":"\r"}}function P(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function E(C){var S=(C=C||{}).delimiter,O=C.newline,x=C.comments,I=C.step,A=C.preview,T=C.fastMode,D=null,L=!1,F=null==C.quoteChar?'"':C.quoteChar,j=F;if(void 0!==C.escapeChar&&(j=C.escapeChar),("string"!=typeof S||-1<v.BAD_DELIMITERS.indexOf(S))&&(S=","),x===S)throw new Error("Comment character same as delimiter");!0===x?x="#":("string"!=typeof x||-1<v.BAD_DELIMITERS.indexOf(x))&&(x=!1),"\n"!==O&&"\r"!==O&&"\r\n"!==O&&(O="\n");var z=0,M=!1;this.parse=function(i,t,r){if("string"!=typeof i)throw new Error("Input must be a string");var n=i.length,e=S.length,s=O.length,a=x.length,o=U(I),h=[],u=[],d=[],f=z=0;if(!i)return w();if(T||!1!==T&&-1===i.indexOf(F)){for(var l=i.split(O),c=0;c<l.length;c++){if(d=l[c],z+=d.length,c!==l.length-1)z+=O.length;else if(r)return w();if(!x||d.substring(0,a)!==x){if(o){if(h=[],k(d.split(S)),R(),M)return w()}else k(d.split(S));if(A&&A<=c)return h=h.slice(0,A),w(!0)}}return w()}for(var p=i.indexOf(S,z),g=i.indexOf(O,z),_=new RegExp(P(j)+P(F),"g"),m=i.indexOf(F,z);;)if(i[z]===F)for(m=z,z++;;){if(-1===(m=i.indexOf(F,m+1)))return r||u.push({type:"Quotes",code:"MissingQuotes",message:"Quoted field unterminated",row:h.length,index:z}),E();if(m===n-1)return E(i.substring(z,m).replace(_,F));if(F===j&&i[m+1]===j)m++;else if(F===j||0===m||i[m-1]!==j){-1!==p&&p<m+1&&(p=i.indexOf(S,m+1));var y=v(-1===(g=-1!==g&&g<m+1?i.indexOf(O,m+1):g)?p:Math.min(p,g));if(i.substr(m+1+y,e)===S){d.push(i.substring(z,m).replace(_,F)),i[z=m+1+y+e]!==F&&(m=i.indexOf(F,z)),p=i.indexOf(S,z),g=i.indexOf(O,z);break}y=v(g);if(i.substring(m+1+y,m+1+y+s)===O){if(d.push(i.substring(z,m).replace(_,F)),b(m+1+y+s),p=i.indexOf(S,z),m=i.indexOf(F,z),o&&(R(),M))return w();if(A&&h.length>=A)return w(!0);break}u.push({type:"Quotes",code:"InvalidQuotes",message:"Trailing quote on quoted field is malformed",row:h.length,index:z}),m++}}else if(x&&0===d.length&&i.substring(z,z+a)===x){if(-1===g)return w();z=g+s,g=i.indexOf(O,z),p=i.indexOf(S,z)}else if(-1!==p&&(p<g||-1===g))d.push(i.substring(z,p)),z=p+e,p=i.indexOf(S,z);else{if(-1===g)break;if(d.push(i.substring(z,g)),b(g+s),o&&(R(),M))return w();if(A&&h.length>=A)return w(!0)}return E();function k(e){h.push(e),f=z}function v(e){var t=0;return t=-1!==e&&(e=i.substring(m+1,e))&&""===e.trim()?e.length:t}function E(e){return r||(void 0===e&&(e=i.substring(z)),d.push(e),z=n,k(d),o&&R()),w()}function b(e){z=e,k(d),d=[],g=i.indexOf(O,z)}function w(e){if(C.header&&!t&&h.length&&!L){var s=h[0],a=Object.create(null),o=new Set(s);let n=!1;for(let r=0;r<s.length;r++){let i=s[r];if(a[i=U(C.transformHeader)?C.transformHeader(i,r):i]){let e,t=a[i];for(;e=i+"_"+t,t++,o.has(e););o.add(e),s[r]=e,a[i]++,n=!0,(D=null===D?{}:D)[e]=i}else a[i]=1,s[r]=i;o.add(i)}n&&console.warn("Duplicate headers found and renamed."),L=!0}return{data:h,errors:u,meta:{delimiter:S,linebreak:O,aborted:M,truncated:!!e,cursor:f+(t||0),renamedHeaders:D}}}function R(){I(w()),h=[],u=[]}},this.abort=function(){M=!0},this.getCharIndex=function(){return z}}function g(e){var t=e.data,i=o[t.workerId],r=!1;if(t.error)i.userError(t.error,t.file);else if(t.results&&t.results.data){var n={abort:function(){r=!0,_(t.workerId,{data:[],errors:[],meta:{aborted:!0}})},pause:m,resume:m};if(U(i.userStep)){for(var s=0;s<t.results.data.length&&(i.userStep({data:t.results.data[s],errors:t.results.errors,meta:t.results.meta},n),!r);s++);delete t.results}else U(i.userChunk)&&(i.userChunk(t.results,n,t.file),delete t.results)}t.finished&&!r&&_(t.workerId,t.results)}function _(e,t){var i=o[e];U(i.userComplete)&&i.userComplete(t),i.terminate(),delete o[e]}function m(){throw new Error("Not implemented.")}function b(e){if("object"!=typeof e||null===e)return e;var t,i=Array.isArray(e)?[]:{};for(t in e)i[t]=b(e[t]);return i}function y(e,t){return function(){e.apply(t,arguments)}}function U(e){return"function"==typeof e}return v.parse=function(e,t){var i=(t=t||{}).dynamicTyping||!1;U(i)&&(t.dynamicTypingFunction=i,i={});if(t.dynamicTyping=i,t.transform=!!U(t.transform)&&t.transform,!t.worker||!v.WORKERS_SUPPORTED)return i=null,v.NODE_STREAM_INPUT,"string"==typeof e?(e=(e=>65279!==e.charCodeAt(0)?e:e.slice(1))(e),i=new(t.download?f:c)(t)):!0===e.readable&&U(e.read)&&U(e.on)?i=new p(t):(n.File&&e instanceof File||e instanceof Object)&&(i=new l(t)),i.stream(e);(i=(()=>{var e;return!!v.WORKERS_SUPPORTED&&(e=(()=>{var e=n.URL||n.webkitURL||null,t=r.toString();return v.BLOB_URL||(v.BLOB_URL=e.createObjectURL(new Blob(["var global = (function() { if (typeof self !== 'undefined') { return self; } if (typeof window !== 'undefined') { return window; } if (typeof global !== 'undefined') { return global; } return {}; })(); global.IS_PAPA_WORKER=true; ","(",t,")();"],{type:"text/javascript"})))})(),(e=new n.Worker(e)).onmessage=g,e.id=h++,o[e.id]=e)})()).userStep=t.step,i.userChunk=t.chunk,i.userComplete=t.complete,i.userError=t.error,t.step=U(t.step),t.chunk=U(t.chunk),t.complete=U(t.complete),t.error=U(t.error),delete t.worker,i.postMessage({input:e,config:t,workerId:i.id})},v.unparse=function(e,t){var n=!1,_=!0,m=",",y="\r\n",s='"',a=s+s,i=!1,r=null,o=!1,h=((()=>{if("object"==typeof t){if("string"!=typeof t.delimiter||v.BAD_DELIMITERS.filter(function(e){return-1!==t.delimiter.indexOf(e)}).length||(m=t.delimiter),"boolean"!=typeof t.quotes&&"function"!=typeof t.quotes&&!Array.isArray(t.quotes)||(n=t.quotes),"boolean"!=typeof t.skipEmptyLines&&"string"!=typeof t.skipEmptyLines||(i=t.skipEmptyLines),"string"==typeof t.newline&&(y=t.newline),"string"==typeof t.quoteChar&&(s=t.quoteChar),"boolean"==typeof t.header&&(_=t.header),Array.isArray(t.columns)){if(0===t.columns.length)throw new Error("Option columns is empty");r=t.columns}void 0!==t.escapeChar&&(a=t.escapeChar+s),t.escapeFormulae instanceof RegExp?o=t.escapeFormulae:"boolean"==typeof t.escapeFormulae&&t.escapeFormulae&&(o=/^[=+\-@\t\r].*$/)}})(),new RegExp(P(s),"g"));"string"==typeof e&&(e=JSON.parse(e));if(Array.isArray(e)){if(!e.length||Array.isArray(e[0]))return u(null,e,i);if("object"==typeof e[0])return u(r||Object.keys(e[0]),e,i)}else if("object"==typeof e)return"string"==typeof e.data&&(e.data=JSON.parse(e.data)),Array.isArray(e.data)&&(e.fields||(e.fields=e.meta&&e.meta.fields||r),e.fields||(e.fields=Array.isArray(e.data[0])?e.fields:"object"==typeof e.data[0]?Object.keys(e.data[0]):[]),Array.isArray(e.data[0])||"object"==typeof e.data[0]||(e.data=[e.data])),u(e.fields||[],e.data||[],i);throw new Error("Unable to serialize unrecognized input");function u(e,t,i){var r="",n=("string"==typeof e&&(e=JSON.parse(e)),"string"==typeof t&&(t=JSON.parse(t)),Array.isArray(e)&&0<e.length),s=!Array.isArray(t[0]);if(n&&_){for(var a=0;a<e.length;a++)0<a&&(r+=m),r+=k(e[a],a);0<t.length&&(r+=y)}for(var o=0;o<t.length;o++){var h=(n?e:t[o]).length,u=!1,d=n?0===Object.keys(t[o]).length:0===t[o].length;if(i&&!n&&(u="greedy"===i?""===t[o].join("").trim():1===t[o].length&&0===t[o][0].length),"greedy"===i&&n){for(var f=[],l=0;l<h;l++){var c=s?e[l]:l;f.push(t[o][c])}u=""===f.join("").trim()}if(!u){for(var p=0;p<h;p++){0<p&&!d&&(r+=m);var g=n&&s?e[p]:p;r+=k(t[o][g],p)}o<t.length-1&&(!i||0<h&&!d)&&(r+=y)}}return r}function k(e,t){var i,r;return null==e?"":e.constructor===Date?JSON.stringify(e).slice(1,25):(r=!1,o&&"string"==typeof e&&o.test(e)&&(e="'"+e,r=!0),i=e.toString().replace(h,a),(r=r||!0===n||"function"==typeof n&&n(e,t)||Array.isArray(n)&&n[t]||((e,t)=>{for(var i=0;i<t.length;i++)if(-1<e.indexOf(t[i]))return!0;return!1})(i,v.BAD_DELIMITERS)||-1<i.indexOf(m)||" "===i.charAt(0)||" "===i.charAt(i.length-1))?s+i+s:i)}},v.RECORD_SEP=String.fromCharCode(30),v.UNIT_SEP=String.fromCharCode(31),v.BYTE_ORDER_MARK="\ufeff",v.BAD_DELIMITERS=["\r","\n",'"',v.BYTE_ORDER_MARK],v.WORKERS_SUPPORTED=!s&&!!n.Worker,v.NODE_STREAM_INPUT=1,v.LocalChunkSize=10485760,v.RemoteChunkSize=5242880,v.DefaultDelimiter=",",v.Parser=E,v.ParserHandle=i,v.NetworkStreamer=f,v.FileStreamer=l,v.StringStreamer=c,v.ReadableStreamStreamer=p,n.jQuery&&((d=n.jQuery).fn.parse=function(o){var i=o.config||{},h=[];return this.each(function(e){if(!("INPUT"===d(this).prop("tagName").toUpperCase()&&"file"===d(this).attr("type").toLowerCase()&&n.FileReader)||!this.files||0===this.files.length)return!0;for(var t=0;t<this.files.length;t++)h.push({file:this.files[t],inputElem:this,instanceConfig:d.extend({},i)})}),e(),this;function e(){if(0===h.length)U(o.complete)&&o.complete();else{var e,t,i,r,n=h[0];if(U(o.before)){var s=o.before(n.file,n.inputElem);if("object"==typeof s){if("abort"===s.action)return e="AbortError",t=n.file,i=n.inputElem,r=s.reason,void(U(o.error)&&o.error({name:e},t,i,r));if("skip"===s.action)return void u();"object"==typeof s.config&&(n.instanceConfig=d.extend(n.instanceConfig,s.config))}else if("skip"===s)return void u()}var a=n.instanceConfig.complete;n.instanceConfig.complete=function(e){U(a)&&a(e,n.file,n.inputElem),u()},v.parse(n.file,n.instanceConfig)}}function u(){h.splice(0,1),e()}}),a&&(n.onmessage=function(e){e=e.data;void 0===v.WORKER_ID&&e&&(v.WORKER_ID=e.workerId);"string"==typeof e.input?n.postMessage({workerId:v.WORKER_ID,results:v.parse(e.input,e.config),finished:!0}):(n.File&&e.input instanceof File||e.input instanceof Object)&&(e=v.parse(e.input,e.config))&&n.postMessage({workerId:v.WORKER_ID,results:e,finished:!0})}),(f.prototype=Object.create(u.prototype)).constructor=f,(l.prototype=Object.create(u.prototype)).constructor=l,(c.prototype=Object.create(c.prototype)).constructor=c,(p.prototype=Object.create(u.prototype)).constructor=p,v});
\ No newline at end of file
+((e,t)=>{"function"==typeof define&&define.amd?define([],t):"object"==typeof module&&"undefined"!=typeof exports?module.exports=t():e.Papa=t()})(this,function i(){var n="undefined"!=typeof self?self:"undefined"!=typeof window?window:void 0!==n?n:{};var l,s=!n.document&&!!n.postMessage,a=n.IS_PAPA_WORKER||!1,o={},h=0,b={};function P(e){return 65279===e.charCodeAt(0)?e.slice(1):e}function C(e){if(""===(e=String(e)))return u(e);for(var t=[],r=0,i=!0;r<e.length;){var n=e.charAt(r);if("."===n){if(i)return u(e);i=!0,r++}else{if("["===n){n=((e,t)=>{var r=t+1;if(r>=e.length)return{valid:!1};if('"'===e.charAt(r)){r++;for(var i="";r<e.length;){var n=e.charAt(r);if("\\"===n){if(r+1>=e.length)return{valid:!1};i+=e.charAt(r+1),r+=2}else{if('"'===n)return"]"!==e.charAt(r+1)?{valid:!1}:{valid:!0,segment:{type:"object",key:i},index:r+2};i+=n,r++}}return{valid:!1}}for(t=r;r<e.length&&"0"<=e.charAt(r)&&e.charAt(r)<="9";)r++;return t===r||"]"!==e.charAt(r)?{valid:!1}:{valid:!0,segment:{type:"array",index:parseInt(e.slice(t,r))},index:r+1}})(e,r);if(!n.valid)return u(e);t.push(n.segment),r=n.index}else{if(!i)return u(e);for(n=r;r<e.length&&"."!==e.charAt(r)&&"["!==e.charAt(r);)r++;n=e.slice(n,r);if(""===n||-1!==n.indexOf("]")||-1!==n.indexOf('"'))return u(e);t.push({type:"object",key:n})}i=!1}}return i?u(e):{valid:!0,header:e,path:t}}function u(e){return{valid:!1,header:e,path:[{type:"object",key:e}],message:"Malformed path header: "+e}}function w(e){for(var t="",r=0;r<e.length;r++){var i=e[r];"array"===i.type?t+="["+i.index+"]":(i=i.key,i=""===(i=String(i))||-1!==i.indexOf(".")||-1!==i.indexOf("[")||-1!==i.indexOf("]")||-1!==i.indexOf('"')?'["'+i.replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"]':i,t&&"["!==i.charAt(0)&&(t+="."),t+=i)}return t}function E(e,t,r,i,n,s){t="array"===t.type?"array":"object";return null==e?"array"==t?[]:{}:x(e)?"array"==t&&!Array.isArray(e)||"object"==t&&Array.isArray(e)?(O("ContainerTypeConflict",r,w(i),n,s),null):e:(O("ValueContainerConflict",r,w(i),n,s),null)}function O(e,t,r,i,n){n("Nested",e,'Nested path conflict for header "'+t+'" at "'+r+'": '+("ContainerTypeConflict"===e?"array vs object":"ValueContainerConflict"===e?"value used as container":"container later as value"),i)}function R(e,t,r){"__proto__"===t?Object.defineProperty(e,t,{value:r,enumerable:!0,writable:!0,configurable:!0}):e[t]=r}function x(e){return null!==e&&"object"==typeof e&&e.constructor!==Date}function f(e){this._handle=null,this._finished=!1,this._completed=!1,this._halted=!1,this._input=null,this._baseIndex=0,this._partialLine="",this._rowCount=0,this._start=0,this._nextChunk=null,this.isFirstChunk=!0,this._completeResults={data:[],errors:[],meta:{}},function(e){var t=S(e);t.chunkSize=parseInt(t.chunkSize),e.step||e.chunk||(t.chunkSize=null);this._handle=new r(t),(this._handle.streamer=this)._config=t}.call(this,e),this.parseChunk=function(t,e){var r=parseInt(this._config.skipFirstNLines)||0;if(this.isFirstChunk&&0<r){let e=this._config.newline;e||(i=this._config.quoteChar||'"',e=this._handle.guessLineEndings(t,i)),t=[...t.split(e).slice(r)].join(e)}this.isFirstChunk&&U(this._config.beforeFirstChunk)&&void 0!==(i=this._config.beforeFirstChunk(t))&&(t=i),this.isFirstChunk=!1,this._halted=!1;var r=this._partialLine+t,i=(this._partialLine="",this._handle.parse(r,this._baseIndex,!this._finished));if(!this._handle.paused()&&!this._handle.aborted()){t=i.meta.cursor,r=(this._finished||(this._partialLine=r.substring(t-this._baseIndex),this._baseIndex=t),i&&i.data&&(this._rowCount+=i.data.length),this._finished||this._config.preview&&this._rowCount>=this._config.preview);if(a)n.postMessage({results:i,workerId:b.WORKER_ID,finished:r});else if(U(this._config.chunk)&&!e){if(this._config.chunk(i,this._handle),this._handle.paused()||this._handle.aborted())return void(this._halted=!0);this._completeResults=i=void 0}return this._config.step||this._config.chunk||(this._completeResults.data=this._completeResults.data.concat(i.data),this._completeResults.errors=this._completeResults.errors.concat(i.errors),this._completeResults.meta=i.meta),this._completed||!r||!U(this._config.complete)||i&&i.meta.aborted||(this._config.complete(this._completeResults,this._input),this._completed=!0),r||i&&i.meta.paused||this._nextChunk(),i}this._halted=!0},this._sendError=function(e){U(this._config.error)?this._config.error(e):a&&this._config.error&&n.postMessage({workerId:b.WORKER_ID,error:e,finished:!1})}}function d(e){var i;(e=e||{}).chunkSize||(e.chunkSize=b.RemoteChunkSize),f.call(this,e),this._nextChunk=s?function(){this._readChunk(),this._chunkLoaded()}:function(){this._readChunk()},this.stream=function(e){this._input=e,this._nextChunk()},this._readChunk=function(){if(this._finished)this._chunkLoaded();else{if(i=new XMLHttpRequest,this._config.withCredentials&&(i.withCredentials=this._config.withCredentials),s||(i.onload=v(this._chunkLoaded,this),i.onerror=v(this._chunkError,this)),i.open(this._config.downloadRequestBody?"POST":"GET",this._input,!s),this._config.downloadRequestHeaders){var e,t=this._config.downloadRequestHeaders;for(e in t)i.setRequestHeader(e,t[e])}var r;this._config.chunkSize&&(r=this._start+this._config.chunkSize-1,i.setRequestHeader("Range","bytes="+this._start+"-"+r));try{i.send(this._config.downloadRequestBody)}catch(e){this._chunkError(e.message)}s&&0===i.status&&this._chunkError()}},this._chunkLoaded=function(){4===i.readyState&&(i.status<200||400<=i.status?this._chunkError():(this._start+=this._config.chunkSize||i.responseText.length,this._finished=!this._config.chunkSize||this._start>=(e=>null!==(e=e.getResponseHeader("Content-Range"))?parseInt(e.substring(e.lastIndexOf("/")+1)):-1)(i),this.parseChunk(i.responseText)))},this._chunkError=function(e){e=i.statusText||e;this._sendError(new Error(e))}}function c(e){(e=e||{}).chunkSize||(e.chunkSize=b.LocalChunkSize),f.call(this,e);var r,i,n="undefined"!=typeof FileReader;this.stream=function(e){this._input=e,i=e.slice||e.webkitSlice||e.mozSlice,n?((r=new FileReader).onload=v(this._chunkLoaded,this),r.onerror=v(this._chunkError,this)):r=new FileReaderSync,this._nextChunk()},this._nextChunk=function(){this._finished||this._config.preview&&!(this._rowCount<this._config.preview)||this._readChunk()},this._readChunk=function(){var e=this._input,t=(this._config.chunkSize&&(t=Math.min(this._start+this._config.chunkSize,this._input.size),e=i.call(e,this._start,t)),r.readAsText(e,this._config.encoding));n||this._chunkLoaded({target:{result:t}})},this._chunkLoaded=function(e){this._start+=this._config.chunkSize,this._finished=!this._config.chunkSize||this._start>=this._input.size,this.parseChunk(e.target.result)},this._chunkError=function(){this._sendError(r.error)}}function p(e){var r;f.call(this,e=e||{}),this.stream=function(e){return r=e,this._nextChunk()},this._nextChunk=function(){var e,t;if(!this._finished)return e=this._config.chunkSize,r=e?(t=r.substring(0,e),r.substring(e)):(t=r,""),this._finished=!r,this.parseChunk(t)}}function g(e){f.call(this,e=e||{});var t=[],r=!0,i=!1;this.pause=function(){f.prototype.pause.apply(this,arguments),this._input.pause()},this.resume=function(){f.prototype.resume.apply(this,arguments),this._input.resume()},this.stream=function(e){this._input=e,this._input.on("data",this._streamData),this._input.on("end",this._streamEnd),this._input.on("error",this._streamError)},this._checkIsFinished=function(){i&&1===t.length&&(this._finished=!0)},this._nextChunk=function(){this._checkIsFinished(),t.length?this.parseChunk(t.shift()):r=!0},this._streamData=v(function(e){try{t.push("string"==typeof e?e:e.toString(this._config.encoding)),r&&(r=!1,this._checkIsFinished(),this.parseChunk(t.shift()))}catch(e){this._streamError(e)}},this),this._streamError=v(function(e){this._streamCleanUp(),this._sendError(e)},this),this._streamEnd=v(function(){this._streamCleanUp(),i=!0,this._streamData("")},this),this._streamCleanUp=v(function(){this._input.removeListener("data",this._streamData),this._input.removeListener("end",this._streamEnd),this._input.removeListener("error",this._streamError)},this)}function r(m){var n,s,a,t,o=Math.pow(2,53),h=-o,u=/^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/,l=/^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/,r=this,i=0,f=0,d=!1,e=!1,c=[],p=[],g={data:[],errors:[],meta:{}};function y(e){return"greedy"===m.skipEmptyLines?""===e.join("").trim():1===e.length&&0===e[0].length}function _(){if(g&&a&&(k("Delimiter","UndetectableDelimiter","Unable to auto-detect delimiting character; defaulted to '"+b.DefaultDelimiter+"'"),a=!1),m.skipEmptyLines&&(g.data=g.data.filter(function(e){return!y(e)})),v()){if(g){if(Array.isArray(g.data[0])){for(var e=0;v()&&e<g.data.length;e++)g.data[e].forEach(i);g.data.splice(0,1)}else g.data.forEach(i);if(m.nested){p=[];for(var t=0;t<c.length;t++){var r=C(c[t]);p.push(r),r.valid||k("Nested","MalformedPath",r.message)}}}function i(e,t){e=P(e),U(m.transformHeader)&&(e=m.transformHeader(e,t)),c.push(e)}}function n(e,t){for(var r=m.header?{}:[],i=0;i<e.length;i++){var n=i,s=e[i],s=((e,t)=>(e=>(m.dynamicTypingFunction&&void 0===m.dynamicTyping[e]&&(m.dynamicTyping[e]=m.dynamicTypingFunction(e)),!0===(m.dynamicTyping[e]||m.dynamicTyping)))(e)?"true"===t||"TRUE"===t||"false"!==t&&"FALSE"!==t&&((e=>{if(u.test(e)){e=parseFloat(e);if(h<e&&e<o)return 1}})(t)?parseFloat(t):l.test(t)?new Date(t):""===t?null:t):t)(n=m.header?i>=c.length?"__parsed_extra":c[i]:n,s=m.transform?m.transform(s,n):s);"__parsed_extra"===n?(r[n]=r[n]||[],r[n].push(s)):m.header&&m.nested?((e,t,r,i,n)=>{if(t&&t.valid)for(var s=e,a=0;a<t.path.length;a++){var o=t.path[a],h=a===t.path.length-1;if("array"===o.type){if(!Array.isArray(s))return O("ContainerTypeConflict",t.header,w(t.path.slice(0,a+1)),i,n);f=l=u=void 0;for(var u=s,l=o.index,f=u.length;f<l;f++)u[f]=null;if(h){if(x(s[o.index]))return O("ContainerValueConflict",t.header,w(t.path.slice(0,a+1)),i,n);s[o.index]=r}else{var d=E(s[o.index],t.path[a+1],t.header,t.path.slice(0,a+1),i,n);if(!d)return;s[o.index]=d,s=d}}else{if(!x(s)||Array.isArray(s))return O(Array.isArray(s)?"ContainerTypeConflict":"ValueContainerConflict",t.header,w(t.path.slice(0,a+1)),i,n);if(h){if(x(s[o.key]))return O("ContainerValueConflict",t.header,w(t.path.slice(0,a+1)),i,n);R(s,o.key,r)}else{d=E(s[o.key],t.path[a+1],t.header,t.path.slice(0,a+1),i,n);if(!d)return;R(s,o.key,d),s=d}}}else R(e,t?t.header:"",r)})(r,p[i],s,f+t,k):r[n]=s}return m.header&&(i>c.length?k("FieldMismatch","TooManyFields","Too many fields: expected "+c.length+" fields but parsed "+i,f+t):i<c.length&&k("FieldMismatch","TooFewFields","Too few fields: expected "+c.length+" fields but parsed "+i,f+t)),r}var s;g&&(m.header||m.dynamicTyping||m.transform)&&(s=1,!g.data.length||Array.isArray(g.data[0])?(g.data=g.data.map(n),s=g.data.length):g.data=n(g.data,0),m.header&&g.meta&&(g.meta.fields=c),f+=s)}function v(){return m.header&&0===c.length}function k(e,t,r,i){e={type:e,code:t,message:r};void 0!==i&&(e.row=i),g.errors.push(e)}U(m.step)&&(t=m.step,m.step=function(e){g=e,v()?_():(_(),0!==g.data.length&&(i+=e.data.length,m.preview&&i>m.preview?s.abort():(g.data=g.data[0],t(g,r))))}),this.parse=function(e,t,r){var i=m.quoteChar||'"',i=(m.newline||(m.newline=this.guessLineEndings(e,i)),a=!1,m.delimiter?U(m.delimiter)&&(m.delimiter=m.delimiter(e),g.meta.delimiter=m.delimiter):((i=((e,t,r,i,n)=>{var s,a,o,h;n=n||[",","\t","|",";",b.RECORD_SEP,b.UNIT_SEP];for(var u=0;u<n.length;u++){for(var l,f=n[u],d=0,c=0,p=0,g=(o=void 0,new A({comments:i,delimiter:f,newline:t,preview:10}).parse(e)),_=0;_<g.data.length;_++)r&&y(g.data[_])?p++:(l=g.data[_].length,c+=l,void 0===o?o=l:0<l&&(d+=Math.abs(l-o),o=l));0<g.data.length&&(c/=g.data.length-p),(void 0===a||d<=a)&&(void 0===h||h<c)&&1.99<c&&(a=d,s=f,h=c)}return{successful:!!(m.delimiter=s),bestDelimiter:s}})(e,m.newline,m.skipEmptyLines,m.comments,m.delimitersToGuess)).successful?m.delimiter=i.bestDelimiter:(a=!0,m.delimiter=b.DefaultDelimiter),g.meta.delimiter=m.delimiter),S(m));return m.preview&&m.header&&i.preview++,n=e,s=new A(i),g=s.parse(n,t,r),_(),d?{meta:{paused:!0}}:g||{meta:{paused:!1}}},this.paused=function(){return d},this.pause=function(){d=!0,s.abort(),n=U(m.chunk)?"":n.substring(s.getCharIndex())},this.resume=function(){r.streamer._halted?(d=!1,r.streamer.parseChunk(n,!0)):setTimeout(r.resume,3)},this.aborted=function(){return e},this.abort=function(){e=!0,s.abort(),g.meta.aborted=!0,U(m.complete)&&m.complete(g),n=""},this.guessLineEndings=function(e,t){e=e.substring(0,1048576);var t=new RegExp(N(t)+"([^]*?)"+N(t),"gm"),r=(e=e.replace(t,"")).split("\r"),t=e.split("\n"),e=1<t.length&&t[0].length<r[0].length;if(1===r.length||e)return"\n";for(var i=0,n=0;n<r.length;n++)"\n"===r[n][0]&&i++;return i>=r.length/2?"\r\n":"\r"}}function N(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function A(O){var R=(O=O||{}).delimiter,x=O.newline,A=O.comments,S=O.step,I=O.preview,T=O.fastMode,D=null,L=!1,j=null==O.quoteChar?'"':O.quoteChar,F=j;if(void 0!==O.escapeChar&&(F=O.escapeChar),("string"!=typeof R||-1<b.BAD_DELIMITERS.indexOf(R))&&(R=","),A===R)throw new Error("Comment character same as delimiter");!0===A?A="#":("string"!=typeof A||-1<b.BAD_DELIMITERS.indexOf(A))&&(A=!1),"\n"!==x&&"\r"!==x&&"\r\n"!==x&&(x="\n");var M=0,z=!1;this.parse=function(r,t,i){if("string"!=typeof r)throw new Error("Input must be a string");var n=r.length,e=R.length,s=x.length,a=A.length,o=U(S),h=[],u=[],l=[],f=M=0;if(!r)return w();if(T||!1!==T&&-1===r.indexOf(j)){for(var d=r.split(x),c=0;c<d.length;c++){if(l=d[c],M+=l.length,c!==d.length-1)M+=x.length;else if(i)return w();if(!A||l.substring(0,a)!==A){if(o){if(h=[],v(l.split(R)),E(),z)return w()}else v(l.split(R));if(I&&I<=c)return h=h.slice(0,I),w(!0)}}return w()}for(var p=r.indexOf(R,M),g=r.indexOf(x,M),_=new RegExp(N(F)+N(j),"g"),m=r.indexOf(j,M);;)if(r[M]===j)for(m=M,M++;;){if(-1===(m=r.indexOf(j,m+1)))return i||u.push({type:"Quotes",code:"MissingQuotes",message:"Quoted field unterminated",row:h.length,index:M}),b();if(m===n-1)return b(r.substring(M,m).replace(_,j));if(j===F&&r[m+1]===F)m++;else if(j===F||0===m||r[m-1]!==F){-1!==p&&p<m+1&&(p=r.indexOf(R,m+1));var y=k(-1===(g=-1!==g&&g<m+1?r.indexOf(x,m+1):g)?p:Math.min(p,g));if(r.substr(m+1+y,e)===R){l.push(r.substring(M,m).replace(_,j)),r[M=m+1+y+e]!==j&&(m=r.indexOf(j,M)),p=r.indexOf(R,M),g=r.indexOf(x,M);break}y=k(g);if(r.substring(m+1+y,m+1+y+s)===x){if(l.push(r.substring(M,m).replace(_,j)),C(m+1+y+s),p=r.indexOf(R,M),m=r.indexOf(j,M),o&&(E(),z))return w();if(I&&h.length>=I)return w(!0);break}u.push({type:"Quotes",code:"InvalidQuotes",message:"Trailing quote on quoted field is malformed",row:h.length,index:M}),m++}}else if(A&&0===l.length&&r.substring(M,M+a)===A){if(-1===g)return w();M=g+s,g=r.indexOf(x,M),p=r.indexOf(R,M)}else if(-1!==p&&(p<g||-1===g))l.push(r.substring(M,p)),M=p+e,p=r.indexOf(R,M);else{if(-1===g)break;if(l.push(r.substring(M,g)),C(g+s),o&&(E(),z))return w();if(I&&h.length>=I)return w(!0)}return b();function v(e){h.push(e),f=M}function k(e){var t=0;return t=-1!==e&&(e=r.substring(m+1,e))&&""===e.trim()?e.length:t}function b(e){return i||(void 0===e&&(e=r.substring(M)),l.push(e),M=n,v(l),o&&E()),w()}function C(e){M=e,v(l),l=[],g=r.indexOf(x,M)}function w(e){if(O.header&&!t&&h.length&&!L){var s=h[0],a=Object.create(null),o=new Set(s);let n=!1;for(let i=0;i<s.length;i++){let r=P(s[i]);if(a[r=U(O.transformHeader)?O.transformHeader(r,i):r]){let e,t=a[r];for(;e=r+"_"+t,t++,o.has(e););o.add(e),s[i]=e,a[r]++,n=!0,(D=null===D?{}:D)[e]=r}else a[r]=1,s[i]=r;o.add(r)}n&&console.warn("Duplicate headers found and renamed."),L=!0}return{data:h,errors:u,meta:{delimiter:R,linebreak:x,aborted:z,truncated:!!e,cursor:f+(t||0),renamedHeaders:D}}}function E(){S(w()),h=[],u=[]}},this.abort=function(){z=!0},this.getCharIndex=function(){return M}}function _(e){var t=e.data,r=o[t.workerId],i=!1;if(t.error)r.userError(t.error,t.file);else if(t.results&&t.results.data){var n={abort:function(){i=!0,m(t.workerId,{data:[],errors:[],meta:{aborted:!0}})},pause:y,resume:y};if(U(r.userStep)){for(var s=0;s<t.results.data.length&&(r.userStep({data:t.results.data[s],errors:t.results.errors,meta:t.results.meta},n),!i);s++);delete t.results}else U(r.userChunk)&&(r.userChunk(t.results,n,t.file),delete t.results)}t.finished&&!i&&m(t.workerId,t.results)}function m(e,t){var r=o[e];U(r.userComplete)&&r.userComplete(t),r.terminate(),delete o[e]}function y(){throw new Error("Not implemented.")}function S(e){if("object"!=typeof e||null===e)return e;var t,r=Array.isArray(e)?[]:{};for(t in e)r[t]=S(e[t]);return r}function v(e,t){return function(){e.apply(t,arguments)}}function U(e){return"function"==typeof e}return b.parse=function(e,t){var r=(t=t||{}).dynamicTyping||!1;U(r)&&(t.dynamicTypingFunction=r,r={});if(t.dynamicTyping=r,t.transform=!!U(t.transform)&&t.transform,!t.worker||!b.WORKERS_SUPPORTED)return r=null,b.NODE_STREAM_INPUT,"string"==typeof e?(e=P(e),r=new(t.download?d:p)(t)):!0===e.readable&&U(e.read)&&U(e.on)?r=new g(t):(n.File&&e instanceof File||e instanceof Object)&&(r=new c(t)),r.stream(e);(r=(()=>{var e;return!!b.WORKERS_SUPPORTED&&(e=(()=>{var e=n.URL||n.webkitURL||null,t=i.toString();return b.BLOB_URL||(b.BLOB_URL=e.createObjectURL(new Blob(["var global = (function() { if (typeof self !== 'undefined') { return self; } if (typeof window !== 'undefined') { return window; } if (typeof global !== 'undefined') { return global; } return {}; })(); global.IS_PAPA_WORKER=true; ","(",t,")();"],{type:"text/javascript"})))})(),(e=new n.Worker(e)).onmessage=_,e.id=h++,o[e.id]=e)})()).userStep=t.step,r.userChunk=t.chunk,r.userComplete=t.complete,r.userError=t.error,t.step=U(t.step),t.chunk=U(t.chunk),t.complete=U(t.complete),t.error=U(t.error),delete t.worker,r.postMessage({input:e,config:t,workerId:r.id})},b.unparse=function(e,t){var s=!1,_=!0,m=",",y="\r\n",a='"',o=a+a,r=!1,i=null,h=!1,n=!1,u=((()=>{if("object"==typeof t){if("string"!=typeof t.delimiter||b.BAD_DELIMITERS.filter(function(e){return-1!==t.delimiter.indexOf(e)}).length||(m=t.delimiter),"boolean"!=typeof t.quotes&&"function"!=typeof t.quotes&&!Array.isArray(t.quotes)||(s=t.quotes),"boolean"!=typeof t.skipEmptyLines&&"string"!=typeof t.skipEmptyLines||(r=t.skipEmptyLines),"string"==typeof t.newline&&(y=t.newline),"string"==typeof t.quoteChar&&(a=t.quoteChar,o=a+a),"boolean"==typeof t.header&&(_=t.header),Array.isArray(t.columns)){if(0===t.columns.length)throw new Error("Option columns is empty");i=t.columns}"boolean"==typeof t.nested&&(n=t.nested),void 0!==t.escapeChar&&(o=t.escapeChar+a),t.escapeFormulae instanceof RegExp?h=t.escapeFormulae:"boolean"==typeof t.escapeFormulae&&t.escapeFormulae&&(h=/^[=+\-@\t\r].*$/)}})(),new RegExp(N(a),"g"));"string"==typeof e&&(e=JSON.parse(e));if(Array.isArray(e)){if(!e.length||Array.isArray(e[0]))return f(null,e,r);if("object"==typeof e[0])return n?l(i,e,r):f(i||Object.keys(e[0]),e,r)}else if("object"==typeof e)return"string"==typeof e.data&&(e.data=JSON.parse(e.data)),Array.isArray(e.data)&&(e.fields||(e.fields=e.meta&&e.meta.fields||i),e.fields||(e.fields=Array.isArray(e.data[0])?e.fields:"object"!=typeof e.data[0]||n?[]:Object.keys(e.data[0])),Array.isArray(e.data[0])||"object"==typeof e.data[0]||(e.data=[e.data])),(!n||!Array.isArray(e.data)||Array.isArray(e.data[0])||e.data.length&&"object"!=typeof e.data[0]?f:l)(e.fields||[],e.data||[],r);throw new Error("Unable to serialize unrecognized input");function l(e,t,r){e=((e,t)=>{"string"==typeof e&&(e=JSON.parse(e)),"string"==typeof t&&(t=JSON.parse(t));var r=Array.isArray(e)&&0<e.length,i=r?e:[],n=Object.create(null),s=[];if(r)for(var a=0;a<i.length;a++)n[i[a]]=!0;for(var o=0;o<t.length;o++)if(r)s.push(((e,t)=>{for(var r={},i=0;i<t.length;i++){var n=t[i];r[n]=((e,t)=>{var r=C(t);if(!r.valid)return e&&e[t];for(var i=e,n=0;n<r.path.length;n++){if(!x(i))return;var s=r.path[n];if("array"===s.type){if(!Array.isArray(i))return;i=i[s.index]}else i=i[s.key]}return i})(e,n)}return r})(t[o],i));else{var h=(e=>{var h={},u=[],l=[];return function e(t,r){if(x(t)){if(-1!==l.indexOf(t))throw new Error("Circular reference detected while flattening nested data");if(l.push(t),Array.isArray(t))for(var i=0;i<t.length;i++)Object.prototype.hasOwnProperty.call(t,i)&&e(t[i],r.concat([{type:"array",index:i}]));else for(var n=Object.keys(t),s=0;s<n.length;s++){var a=n[s];e(t[a],r.concat([{type:"object",key:a}]))}l.pop()}else{var o;0<r.length&&(o=w(r),h[o]=t,u.push(o))}}(e,[]),{row:h,fields:u}})(t[o]);s.push(h.row);for(var u=0;u<h.fields.length;u++){var l=h.fields[u];n[l]||(n[l]=!0,i.push(l))}}return{fields:i,data:s}})(e,t);return f(e.fields,e.data,r)}function f(e,t,r){var i="",n=("string"==typeof e&&(e=JSON.parse(e)),"string"==typeof t&&(t=JSON.parse(t)),Array.isArray(e)&&0<e.length),s=!Array.isArray(t[0]);if(n&&_){for(var a=0;a<e.length;a++)0<a&&(i+=m),i+=v(e[a],a);0<t.length&&(i+=y)}for(var o=0;o<t.length;o++){var h=(n?e:t[o]).length,u=!1,l=n?0===Object.keys(t[o]).length:0===t[o].length;if(r&&!n&&(u="greedy"===r?""===t[o].join("").trim():1===t[o].length&&0===t[o][0].length),"greedy"===r&&n){for(var f=[],d=0;d<h;d++){var c=s?e[d]:d;f.push(t[o][c])}u=""===f.join("").trim()}if(!u){for(var p=0;p<h;p++){0<p&&!l&&(i+=m);var g=n&&s?e[p]:p;i+=v(t[o][g],p)}o<t.length-1&&(!r||0<h&&!l)&&(i+=y)}}return i}function v(e,t){var r,i,n;return null==e?"":e.constructor===Date?JSON.stringify(e).slice(1,25):(n=!1,h&&"string"==typeof e&&h.test(e)&&(e="'"+e,n=!0),i=(r=e.toString()).replace(u,o),(n=n||!0===s||"function"==typeof s&&s(e,t)||Array.isArray(s)&&s[t]||((e,t)=>{for(var r=0;r<t.length;r++)if(-1<e.indexOf(t[r]))return!0;return!1})(i,b.BAD_DELIMITERS)||-1<i.indexOf(m)||-1<r.indexOf(a)||" "===i.charAt(0)||" "===i.charAt(i.length-1))?a+i+a:i)}},b.RECORD_SEP=String.fromCharCode(30),b.UNIT_SEP=String.fromCharCode(31),b.BYTE_ORDER_MARK="\ufeff",b.BAD_DELIMITERS=["\r","\n",'"',b.BYTE_ORDER_MARK],b.WORKERS_SUPPORTED=!s&&!!n.Worker,b.NODE_STREAM_INPUT=1,b.LocalChunkSize=10485760,b.RemoteChunkSize=5242880,b.DefaultDelimiter=",",b.Parser=A,b.ParserHandle=r,b.NetworkStreamer=d,b.FileStreamer=c,b.StringStreamer=p,b.ReadableStreamStreamer=g,n.jQuery&&((l=n.jQuery).fn.parse=function(o){var r=o.config||{},h=[];return this.each(function(e){if(!("INPUT"===l(this).prop("tagName").toUpperCase()&&"file"===l(this).attr("type").toLowerCase()&&n.FileReader)||!this.files||0===this.files.length)return!0;for(var t=0;t<this.files.length;t++)h.push({file:this.files[t],inputElem:this,instanceConfig:l.extend({},r)})}),e(),this;function e(){if(0===h.length)U(o.complete)&&o.complete();else{var e,t,r,i,n=h[0];if(U(o.before)){var s=o.before(n.file,n.inputElem);if("object"==typeof s){if("abort"===s.action)return e="AbortError",t=n.file,r=n.inputElem,i=s.reason,void(U(o.error)&&o.error({name:e},t,r,i));if("skip"===s.action)return void u();"object"==typeof s.config&&(n.instanceConfig=l.extend(n.instanceConfig,s.config))}else if("skip"===s)return void u()}var a=n.instanceConfig.complete;n.instanceConfig.complete=function(e){U(a)&&a(e,n.file,n.inputElem),u()},b.parse(n.file,n.instanceConfig)}}function u(){h.splice(0,1),e()}}),a&&(n.onmessage=function(e){e=e.data;void 0===b.WORKER_ID&&e&&(b.WORKER_ID=e.workerId);"string"==typeof e.input?n.postMessage({workerId:b.WORKER_ID,results:b.parse(e.input,e.config),finished:!0}):(n.File&&e.input instanceof File||e.input instanceof Object)&&(e=b.parse(e.input,e.config))&&n.postMessage({workerId:b.WORKER_ID,results:e,finished:!0})}),(d.prototype=Object.create(f.prototype)).constructor=d,(c.prototype=Object.create(f.prototype)).constructor=c,(p.prototype=Object.create(p.prototype)).constructor=p,(g.prototype=Object.create(f.prototype)).constructor=g,b});
\ No newline at end of file
diff --git a/tests/test-cases.js b/tests/test-cases.js
index 321bbc2..765ab6f 100644
--- a/tests/test-cases.js
+++ b/tests/test-cases.js
@@ -1291,6 +1291,74 @@ var PARSE_TESTS = [
 			errors: []
 		}
 	},
+	{
+		description: "Nested headers rebuild objects and arrays",
+		input: 'id,user.name,user.age,tags[0],tags[1],"[""a.b""].c"\r\n1,Ann,30,x,y,dot',
+		config: { header: true, nested: true, dynamicTyping: true },
+		expected: {
+			data: [{id: 1, user: {name: 'Ann', age: 30}, tags: ['x', 'y'], 'a.b': {c: 'dot'}}],
+			errors: []
+		}
+	},
+	{
+		description: "Nested quoted bracket headers preserve path characters in keys",
+		input: '"[""a.b[0]\\""x""]"\nquoted',
+		config: { header: true, nested: true, delimiter: ',', newline: '\n' },
+		expected: {
+			data: [{'a.b[0]"x': 'quoted'}],
+			errors: []
+		}
+	},
+	{
+		description: "Nested array path fills sparse gaps with null",
+		input: 'items[2]\nx',
+		config: { header: true, nested: true, delimiter: ',', newline: '\n' },
+		expected: {
+			data: [{items: [null, null, 'x']}],
+			errors: []
+		}
+	},
+	{
+		description: "Nested malformed path header reports error and remains literal",
+		input: 'bad[,ok\nx,y',
+		config: { header: true, nested: true, delimiter: ',', newline: '\n' },
+		expected: {
+			data: [{'bad[': 'x', ok: 'y'}],
+			errors: [{
+				"type": "Nested",
+				"code": "MalformedPath",
+				"message": "Malformed path header: bad["
+			}]
+		}
+	},
+	{
+		description: "Nested path conflicts preserve first values and unrelated fields",
+		input: 'a,a.b,b.c,b,c[0],c.d,ok\n1,2,3,4,5,6,7',
+		config: { header: true, nested: true },
+		expected: {
+			data: [{a: '1', b: {c: '3'}, c: ['5'], ok: '7'}],
+			errors: [
+				{
+					"type": "Nested",
+					"code": "ValueContainerConflict",
+					"message": "Nested path conflict for header \"a.b\" at \"a\": value used as container",
+					"row": 0
+				},
+				{
+					"type": "Nested",
+					"code": "ContainerValueConflict",
+					"message": "Nested path conflict for header \"b\" at \"b\": container later as value",
+					"row": 0
+				},
+				{
+					"type": "Nested",
+					"code": "ContainerTypeConflict",
+					"message": "Nested path conflict for header \"c.d\" at \"c\": array vs object",
+					"row": 0
+				}
+			]
+		}
+	},
 	{
 		description: "Lines with comments are not used when guessing the delimiter in an escaped file",
 		notes: "Guessing the delimiter should work even if there are many lines of comments at the start of the file",
@@ -2124,6 +2192,24 @@ var UNPARSE_TESTS = [
 		config: { escapeFormulae: true, quotes: true, quoteChar: "'", escapeChar: "'" },
 		expected: '\'Col1\',\'Col2\',\'Col3\'\r\n\'\'\'\tdanger\',\'\'\'\rdanger,\',\'safe, \t\r\''
 	},
+	{
+		description: "Nested unparse flattens object and array columns in first-seen order",
+		input: [{id: 1, user: {name: 'Ann'}, tags: ['x', 'y'], 'a.b': {c: 'dot'}}, {id: 2, user: {age: 30}, tags: ['z'], active: true}],
+		config: { nested: true },
+		expected: 'id,user.name,tags[0],tags[1],"[""a.b""].c",user.age,active\r\n1,Ann,x,y,dot,,\r\n2,,z,,,30,true'
+	},
+	{
+		description: "Nested unparse respects columns option as paths",
+		input: [{id: 1, user: {name: 'Ann'}, tags: ['x', 'y']}, {id: 2, user: {age: 30}, tags: ['z']}],
+		config: { nested: true, columns: ['user.age', 'id', 'tags[1]'] },
+		expected: 'user.age,id,tags[1]\r\n,1,y\r\n30,2,'
+	},
+	{
+		description: "Nested unparse quotes path characters in keys",
+		input: [{'a.b[0]"x': 'quoted'}],
+		config: { nested: true },
+		expected: '"[""a.b[0]\\""x""]"\r\nquoted'
+	},
 ];
 
 describe('Unparse Tests', function() {
@@ -2147,6 +2233,15 @@ describe('Unparse Tests', function() {
 	for (var i = 0; i < UNPARSE_TESTS.length; i++) {
 		generateTest(UNPARSE_TESTS[i]);
 	}
+
+	it('Nested unparse detects circular references', function() {
+		var row = {id: 1};
+		row.self = row;
+
+		assert.throws(function() {
+			Papa.unparse([row], { nested: true });
+		}, /Circular reference/);
+	});
 });
 
 

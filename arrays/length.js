diff --git a/docs/docs.html b/docs/docs.html
index ac39363..c8d9c61 100644
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
+									If <code>true</code>, nested objects and arrays are flattened into path headers. Object keys are joined with dots, array indexes use bracket notation, and object keys containing <code>.</code>, <code>[</code>, <code>]</code>, or <code>&quot;</code> are written as quoted bracket segments. Columns are unioned across rows in first-seen order unless <code>columns</code> is provided.
+								</td>
+							</tr>
 							<tr>
 								<td>
 									<code>escapeFormulae</code>
@@ -432,6 +441,7 @@ var csv = Papa.unparse({
 	escapeChar: '"',
 	header: false,
 	transformHeader: undefined,
+	nested: false,
 	dynamicTyping: false,
 	preview: 0,
 	encoding: "",
@@ -516,6 +526,14 @@ var csv = Papa.unparse({
 									Only available starting with version 5.0.
 								</td>
 							</tr>
+							<tr>
+								<td>
+									<code>nested</code>
+								</td>
+								<td>
+									If <code>true</code> with <code>header</code>, header names are interpreted as nested paths and rebuilt into objects and arrays. Malformed path headers are reported and kept as literal keys; conflicting paths are reported while preserving unrelated fields.
+								</td>
+							</tr>
 							<tr>
 								<td>
 									<code>dynamicTyping</code>
diff --git a/papaparse.js b/papaparse.js
index b98897a..a5df9cc 100755
--- a/papaparse.js
+++ b/papaparse.js
@@ -292,6 +292,9 @@ License: MIT
 		/** whether to prevent outputting cells that can be parsed as formulae by spreadsheet software (Excel and LibreOffice) */
 		var _escapeFormulae = false;
 
+		/** whether nested objects and arrays should be flattened into path headers */
+		var _nested = false;
+
 		unpackConfig();
 
 		var quoteCharRegex = new RegExp(escapeRegExp(_quoteChar), 'g');
@@ -304,7 +307,7 @@ License: MIT
 			if (!_input.length || Array.isArray(_input[0]))
 				return serialize(null, _input, _skipEmptyLines);
 			else if (typeof _input[0] === 'object')
-				return serialize(_columns || Object.keys(_input[0]), _input, _skipEmptyLines);
+				return serialize(_nested ? _columns : _columns || Object.keys(_input[0]), _input, _skipEmptyLines);
 		}
 		else if (typeof _input === 'object')
 		{
@@ -317,7 +320,7 @@ License: MIT
 					_input.fields = _input.meta && _input.meta.fields || _columns;
 
 				if (!_input.fields)
-					_input.fields =  Array.isArray(_input.data[0])
+					_input.fields =  Array.isArray(_input.data[0]) || _nested
 						? _input.fields
 						: typeof _input.data[0] === 'object'
 							? Object.keys(_input.data[0])
@@ -381,6 +384,9 @@ License: MIT
 			} else if (typeof _config.escapeFormulae === 'boolean' && _config.escapeFormulae) {
 				_escapeFormulae =  /^[=+\-@\t\r].*$/;
 			}
+
+			if (typeof _config.nested === 'boolean')
+				_nested = _config.nested;
 		}
 
 		/** The double for loop that iterates the data and writes out a CSV string including header row */
@@ -393,6 +399,13 @@ License: MIT
 			if (typeof data === 'string')
 				data = JSON.parse(data);
 
+			if (_nested && Array.isArray(data) && data.length && !Array.isArray(data[0]) && typeof data[0] === 'object')
+			{
+				var nested = flattenNestedRows(fields, data);
+				fields = nested.fields;
+				data = nested.data;
+			}
+
 			var hasHeader = Array.isArray(fields) && fields.length > 0;
 			var dataKeyedByField = !(Array.isArray(data[0]));
 
@@ -487,6 +500,235 @@ License: MIT
 		}
 	}
 
+	function flattenNestedRows(fields, data)
+	{
+		var columns = Array.isArray(fields) && fields.length ? fields.slice() : null;
+		var outputFields = columns || [];
+		var seenFields = {};
+		var outputData = [];
+
+		for (var c = 0; c < outputFields.length; c++)
+			seenFields[outputFields[c]] = true;
+
+		for (var row = 0; row < data.length; row++)
+			detectCircularReferences(data[row], []);
+
+		for (var i = 0; i < data.length; i++)
+		{
+			var flatRow = {};
+
+			if (columns)
+			{
+				for (var col = 0; col < columns.length; col++)
+					flatRow[columns[col]] = getNestedValue(data[i], columns[col]);
+			}
+			else
+			{
+				flattenNestedValue(data[i], [], flatRow, function(field) {
+					if (!seenFields[field])
+					{
+						seenFields[field] = true;
+						outputFields.push(field);
+					}
+				});
+			}
+
+			outputData.push(flatRow);
+		}
+
+		return { fields: outputFields, data: outputData };
+	}
+
+	function flattenNestedValue(value, path, row, addField)
+	{
+		if (value === null || typeof value !== 'object' || value.constructor === Date)
+		{
+			var field = nestedPathToString(path);
+			row[field] = value;
+			addField(field);
+			return;
+		}
+
+		if (Array.isArray(value))
+		{
+			if (value.length === 0 && path.length)
+			{
+				var arrayField = nestedPathToString(path);
+				row[arrayField] = value;
+				addField(arrayField);
+			}
+
+			for (var i = 0; i < value.length; i++)
+				flattenNestedValue(i in value ? value[i] : null, path.concat([{ type: 'index', value: i }]), row, addField);
+			return;
+		}
+
+		var keys = Object.keys(value);
+		if (keys.length === 0 && path.length)
+		{
+			var objectField = nestedPathToString(path);
+			row[objectField] = value;
+			addField(objectField);
+			return;
+		}
+
+		for (var key = 0; key < keys.length; key++)
+			flattenNestedValue(value[keys[key]], path.concat([{ type: 'key', value: keys[key] }]), row, addField);
+	}
+
+	function detectCircularReferences(value, ancestors)
+	{
+		if (value === null || typeof value !== 'object')
+			return;
+
+		for (var i = 0; i < ancestors.length; i++)
+			if (ancestors[i] === value)
+				throw new Error('Circular reference detected');
+
+		ancestors.push(value);
+		if (Array.isArray(value))
+		{
+			for (var index = 0; index < value.length; index++)
+				if (index in value)
+					detectCircularReferences(value[index], ancestors);
+		}
+		else
+		{
+			var keys = Object.keys(value);
+			for (var key = 0; key < keys.length; key++)
+				detectCircularReferences(value[keys[key]], ancestors);
+		}
+		ancestors.pop();
+	}
+
+	function nestedPathToString(path)
+	{
+		var field = '';
+		for (var i = 0; i < path.length; i++)
+		{
+			var segment = path[i];
+			if (segment.type === 'index')
+				field += '[' + segment.value + ']';
+			else
+			{
+				var key = segment.value;
+				var needsBracket = key === '' || key.indexOf('.') !== -1 || key.indexOf('[') !== -1 || key.indexOf(']') !== -1 || key.indexOf('"') !== -1;
+				var encoded = needsBracket ? '[' + JSON.stringify(key) + ']' : key;
+				field += field ? '.' + encoded : encoded;
+			}
+		}
+
+		return field;
+	}
+
+	function getNestedValue(row, field)
+	{
+		var parsedPath = parseNestedPath(field);
+		if (parsedPath.error)
+			return row[field];
+
+		var current = row;
+		for (var i = 0; i < parsedPath.segments.length; i++)
+		{
+			if (current === null || typeof current === 'undefined')
+				return undefined;
+
+			var segment = parsedPath.segments[i];
+			current = current[segment.value];
+		}
+
+		return current;
+	}
+
+	function parseNestedPath(field)
+	{
+		var segments = [];
+		var i = 0;
+		var expectSegment = true;
+
+		if (field === '')
+			return { error: true, segments: [] };
+
+		while (i < field.length)
+		{
+			if (field.charAt(i) === '.')
+			{
+				if (expectSegment)
+					return { error: true, segments: [] };
+				expectSegment = true;
+				i++;
+				continue;
+			}
+
+			if (field.charAt(i) === '[')
+			{
+				var bracket = parseBracketSegment(field, i);
+				if (bracket.error)
+					return { error: true, segments: [] };
+				segments.push(bracket.segment);
+				i = bracket.index;
+				expectSegment = false;
+				continue;
+			}
+
+			var start = i;
+			while (i < field.length && field.charAt(i) !== '.' && field.charAt(i) !== '[')
+				i++;
+			var key = field.substring(start, i);
+			if (/[\]"]/.test(key))
+				return { error: true, segments: [] };
+			segments.push({ type: 'key', value: key });
+			expectSegment = false;
+		}
+
+		if (expectSegment)
+			return { error: true, segments: [] };
+
+		return { error: false, segments: segments };
+	}
+
+	function parseBracketSegment(field, index)
+	{
+		var next = index + 1;
+		if (field.charAt(next) === '"')
+		{
+			var end = next + 1;
+			var escaped = false;
+			while (end < field.length)
+			{
+				var character = field.charAt(end);
+				if (character === '"' && !escaped)
+					break;
+				escaped = character === '\\' && !escaped;
+				if (character !== '\\')
+					escaped = false;
+				end++;
+			}
+
+			if (end >= field.length || field.charAt(end + 1) !== ']')
+				return { error: true };
+
+			try
+			{
+				return { segment: { type: 'key', value: JSON.parse(field.substring(next, end + 1)) }, index: end + 2 };
+			}
+			catch (e)
+			{
+				return { error: true };
+			}
+		}
+
+		var close = field.indexOf(']', next);
+		if (close === -1)
+			return { error: true };
+
+		var indexText = field.substring(next, close);
+		if (!/^\d+$/.test(indexText))
+			return { error: true };
+
+		return { segment: { type: 'index', value: parseInt(indexText) }, index: close + 1 };
+	}
+
 
 	/** ChunkStreamer is the base prototype for various streamer implementations. */
 	function ChunkStreamer(config)
@@ -1282,7 +1524,7 @@ License: MIT
 
 		function applyHeaderAndDynamicTypingAndTransformation()
 		{
-			if (!_results || (!_config.header && !_config.dynamicTyping && !_config.transform))
+			if (!_results || (!_config.header && !_config.dynamicTyping && !_config.transform && !_config.nested))
 				return _results;
 
 			function processRow(rowSource, i)
@@ -1308,6 +1550,8 @@ License: MIT
 						row[field] = row[field] || [];
 						row[field].push(value);
 					}
+					else if (_config.header && _config.nested)
+						assignNestedValue(row, field, value, _rowCounter + i, addError);
 					else
 						row[field] = value;
 				}
@@ -1407,6 +1651,74 @@ License: MIT
 			}
 			_results.errors.push(error);
 		}
+
+		function assignNestedValue(row, field, value, rowIndex, addNestedError)
+		{
+			var parsedPath = parseNestedPath(field);
+			if (parsedPath.error)
+			{
+				addNestedError('Nested', 'MalformedPath', 'Malformed path header: ' + field, rowIndex);
+				row[field] = value;
+				return;
+			}
+
+			var target = row;
+			var segments = parsedPath.segments;
+			for (var i = 0; i < segments.length; i++)
+			{
+				var segment = segments[i];
+				var last = i === segments.length - 1;
+
+				if (segment.type === 'index' && !Array.isArray(target))
+				{
+					addNestedError('Nested', 'ArrayObjectConflict', 'Array vs object conflict for path header: ' + field, rowIndex);
+					return;
+				}
+
+				if (segment.type === 'index')
+					fillArrayGaps(target, segment.value);
+
+				if (last)
+				{
+					if (target[segment.value] !== undefined && target[segment.value] !== null && typeof target[segment.value] === 'object')
+					{
+						addNestedError('Nested', 'ContainerValueConflict', 'Container later used as value for path header: ' + field, rowIndex);
+						return;
+					}
+
+					target[segment.value] = value;
+					return;
+				}
+
+				var nextSegment = segments[i + 1];
+				var expectedArray = nextSegment.type === 'index';
+				var current = target[segment.value];
+
+				if (typeof current === 'undefined' || current === null)
+				{
+					current = expectedArray ? [] : {};
+					target[segment.value] = current;
+				}
+				else if (typeof current !== 'object')
+				{
+					addNestedError('Nested', 'ValueContainerConflict', 'Value used as container for path header: ' + field, rowIndex);
+					return;
+				}
+				else if (Array.isArray(current) !== expectedArray)
+				{
+					addNestedError('Nested', 'ArrayObjectConflict', 'Array vs object conflict for path header: ' + field, rowIndex);
+					return;
+				}
+
+				target = current;
+			}
+		}
+
+		function fillArrayGaps(array, index)
+		{
+			while (array.length < index)
+				array.push(null);
+		}
 	}
 
 	/** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions */
diff --git a/tests/test-cases.js b/tests/test-cases.js
index 321bbc2..166f528 100644
--- a/tests/test-cases.js
+++ b/tests/test-cases.js
@@ -752,6 +752,37 @@ var PARSE_TESTS = [
 			errors: []
 		}
 	},
+	{
+		description: "Nested header paths rebuild objects and arrays",
+		input: 'id,user.name,user.tags[0],user.tags[2],"[""a.b""].[""c[]""]",plain\r\n1,Ada,admin,owner,x,y',
+		config: { header: true, nested: true },
+		expected: {
+			data: [{ id: '1', user: { name: 'Ada', tags: ['admin', null, 'owner'] }, 'a.b': { 'c[]': 'x' }, plain: 'y' }],
+			errors: []
+		}
+	},
+	{
+		description: "Nested malformed path headers are kept as literal keys with errors",
+		input: 'a[,good.path\r\nbad,ok',
+		config: { header: true, nested: true },
+		expected: {
+			data: [{ 'a[': 'bad', good: { path: 'ok' } }],
+			errors: [{ type: 'Nested', code: 'MalformedPath', message: 'Malformed path header: a[', row: 0 }]
+		}
+	},
+	{
+		description: "Nested conflict errors preserve unrelated fields",
+		input: 'a,a.b,container.child,container,items[0],items.name,ok\r\nscalar,child,leaf,parent,first,name,yes',
+		config: { header: true, nested: true },
+		expected: {
+			data: [{ a: 'scalar', container: { child: 'leaf' }, items: ['first'], ok: 'yes' }],
+			errors: [
+				{ type: 'Nested', code: 'ValueContainerConflict', message: 'Value used as container for path header: a.b', row: 0 },
+				{ type: 'Nested', code: 'ContainerValueConflict', message: 'Container later used as value for path header: container', row: 0 },
+				{ type: 'Nested', code: 'ArrayObjectConflict', message: 'Array vs object conflict for path header: items.name', row: 0 }
+			]
+		}
+	},
 	{
 		description: "Header row only",
 		input: 'A,B,C',
@@ -2124,6 +2155,27 @@ var UNPARSE_TESTS = [
 		config: { escapeFormulae: true, quotes: true, quoteChar: "'", escapeChar: "'" },
 		expected: '\'Col1\',\'Col2\',\'Col3\'\r\n\'\'\'\tdanger\',\'\'\'\rdanger,\',\'safe, \t\r\''
 	},
+	{
+		description: "Nested objects and arrays flatten into path headers in first-seen order",
+		input: [
+			{ id: 1, user: { name: 'Ada', tags: (function() { var tags = ['admin']; tags[2] = 'owner'; return tags; })() }, 'a.b': { 'c[]': 'quoted' } },
+			{ user: { age: 36 }, extra: true }
+		],
+		config: { nested: true },
+		expected: 'id,user.name,user.tags[0],user.tags[1],user.tags[2],"[""a.b""].[""c[]""]",user.age,extra\r\n1,Ada,admin,,owner,quoted,,\r\n,,,,,,36,true'
+	},
+	{
+		description: "Nested unparse respects explicit columns",
+		input: [{ id: 1, user: { name: 'Ada', age: 36 } }],
+		config: { nested: true, columns: ['user.age', 'id'] },
+		expected: 'user.age,id\r\n36,1'
+	},
+	{
+		description: "Nested unparse detects circular references",
+		input: (function() { var row = { id: 1 }; row.self = row; return [row]; })(),
+		config: { nested: true },
+		expectedError: /Circular reference/
+	},
 ];
 
 describe('Unparse Tests', function() {
@@ -2134,12 +2186,19 @@ describe('Unparse Tests', function() {
 			try {
 				actual = Papa.unparse(test.input, test.config);
 			} catch (e) {
+				if (test.expectedError) {
+					assert.match(e.message, test.expectedError);
+					return;
+				}
 				if (e instanceof Error) {
 					throw e;
 				}
 				actual = e;
 			}
 
+			if (test.expectedError)
+				assert.fail('Expected error matching ' + test.expectedError);
+
 			assert.strictEqual(actual, test.expected);
 		});
 	}

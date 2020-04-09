define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    const hasLocalStorage = typeof localStorage !== `undefined`;
    const hasProcess = typeof process !== `undefined`;
    const shouldDebug = (hasLocalStorage && localStorage.getItem('DEBUG')) || (hasProcess && process.env.DEBUG);
    const debugLog = shouldDebug ? console.log : (_message, ..._optionalParams) => '';
    /**
     * Makes a virtual copy of the TypeScript environment. This is the main API you want to be using with
     * typescript-vfs. A lot of the other exposed functions are used by this function to get set up.
     *
     * @param sys an object which conforms to the TS Sys (a shim over read/write access to the fs)
     * @param rootFiles a list of files which are considered inside the project
     * @param ts a copy pf the TypeScript module
     * @param compilerOptions the options for this compiler run
     */
    function createVirtualTypeScriptEnvironment(sys, rootFiles, ts, compilerOptions = {}) {
        const mergedCompilerOpts = Object.assign(Object.assign({}, defaultCompilerOptions(ts)), compilerOptions);
        const { languageServiceHost, updateFile } = createVirtualLanguageServiceHost(sys, rootFiles, mergedCompilerOpts, ts);
        const languageService = ts.createLanguageService(languageServiceHost);
        const diagnostics = languageService.getCompilerOptionsDiagnostics();
        if (diagnostics.length) {
            const compilerHost = createVirtualCompilerHost(sys, compilerOptions, ts);
            throw new Error(ts.formatDiagnostics(diagnostics, compilerHost.compilerHost));
        }
        return {
            sys,
            languageService,
            getSourceFile: fileName => { var _a; return (_a = languageService.getProgram()) === null || _a === void 0 ? void 0 : _a.getSourceFile(fileName); },
            createFile: (fileName, content) => {
                updateFile(ts.createSourceFile(fileName, content, mergedCompilerOpts.target, false));
            },
            updateFile: (fileName, content, optPrevTextSpan) => {
                const prevSourceFile = languageService.getProgram().getSourceFile(fileName);
                const prevFullContents = prevSourceFile.text;
                // TODO: Validate if the default text span has a fencepost error?
                const prevTextSpan = optPrevTextSpan !== null && optPrevTextSpan !== void 0 ? optPrevTextSpan : ts.createTextSpan(0, prevFullContents.length);
                const newText = prevFullContents.slice(0, prevTextSpan.start) +
                    content +
                    prevFullContents.slice(prevTextSpan.start + prevTextSpan.length);
                const newSourceFile = ts.updateSourceFile(prevSourceFile, newText, {
                    span: prevTextSpan,
                    newLength: content.length,
                });
                updateFile(newSourceFile);
            },
        };
    }
    exports.createVirtualTypeScriptEnvironment = createVirtualTypeScriptEnvironment;
    /**
     * Grab the list of lib files for a particular target, will return a bit more than necessary (by including
     * the dom) but that's OK
     *
     * @param target The compiler settings target baseline
     * @param ts A copy of the TypeScript module
     */
    exports.knownLibFilesForCompilerOptions = (compilerOptions, ts) => {
        const target = compilerOptions.target || ts.ScriptTarget.ES5;
        const lib = compilerOptions.lib || [];
        const files = [
            'lib.d.ts',
            'lib.dom.d.ts',
            'lib.dom.iterable.d.ts',
            'lib.webworker.d.ts',
            'lib.webworker.importscripts.d.ts',
            'lib.scripthost.d.ts',
            'lib.es5.d.ts',
            'lib.es6.d.ts',
            'lib.es2015.collection.d.ts',
            'lib.es2015.core.d.ts',
            'lib.es2015.d.ts',
            'lib.es2015.generator.d.ts',
            'lib.es2015.iterable.d.ts',
            'lib.es2015.promise.d.ts',
            'lib.es2015.proxy.d.ts',
            'lib.es2015.reflect.d.ts',
            'lib.es2015.symbol.d.ts',
            'lib.es2015.symbol.wellknown.d.ts',
            'lib.es2016.array.include.d.ts',
            'lib.es2016.d.ts',
            'lib.es2016.full.d.ts',
            'lib.es2017.d.ts',
            'lib.es2017.full.d.ts',
            'lib.es2017.intl.d.ts',
            'lib.es2017.object.d.ts',
            'lib.es2017.sharedmemory.d.ts',
            'lib.es2017.string.d.ts',
            'lib.es2017.typedarrays.d.ts',
            'lib.es2018.asyncgenerator.d.ts',
            'lib.es2018.asynciterable.d.ts',
            'lib.es2018.d.ts',
            'lib.es2018.full.d.ts',
            'lib.es2018.intl.d.ts',
            'lib.es2018.promise.d.ts',
            'lib.es2018.regexp.d.ts',
            'lib.es2019.array.d.ts',
            'lib.es2019.d.ts',
            'lib.es2019.full.d.ts',
            'lib.es2019.object.d.ts',
            'lib.es2019.string.d.ts',
            'lib.es2019.symbol.d.ts',
            'lib.es2020.d.ts',
            'lib.es2020.full.d.ts',
            'lib.es2020.string.d.ts',
            'lib.es2020.symbol.wellknown.d.ts',
            'lib.esnext.array.d.ts',
            'lib.esnext.asynciterable.d.ts',
            'lib.esnext.bigint.d.ts',
            'lib.esnext.d.ts',
            'lib.esnext.full.d.ts',
            'lib.esnext.intl.d.ts',
            'lib.esnext.symbol.d.ts',
        ];
        const targetToCut = ts.ScriptTarget[target];
        const matches = files.filter(f => f.startsWith(`lib.${targetToCut.toLowerCase()}`));
        const targetCutIndex = files.indexOf(matches.pop());
        const getMax = (array) => array && array.length ? array.reduce((max, current) => (current > max ? current : max)) : undefined;
        // Find the index for everything in
        const indexesForCutting = lib.map(lib => {
            const matches = files.filter(f => f.startsWith(`lib.${lib.toLowerCase()}`));
            if (matches.length === 0)
                return 0;
            const cutIndex = files.indexOf(matches.pop());
            return cutIndex;
        });
        const libCutIndex = getMax(indexesForCutting) || 0;
        const finalCutIndex = Math.max(targetCutIndex, libCutIndex);
        return files.slice(0, finalCutIndex + 1);
    };
    /**
     * Sets up a Map with lib contents by grabbing the necessary files from
     * the local copy of typescript via the file system.
     */
    exports.createDefaultMapFromNodeModules = (compilerOptions) => {
        const ts = require('typescript');
        const path = require('path');
        const fs = require('fs');
        const getLib = (name) => {
            const lib = path.dirname(require.resolve('typescript'));
            return fs.readFileSync(path.join(lib, name), 'utf8');
        };
        const libs = exports.knownLibFilesForCompilerOptions(compilerOptions, ts);
        const fsMap = new Map();
        libs.forEach(lib => {
            fsMap.set('/' + lib, getLib(lib));
        });
        return fsMap;
    };
    /**
     * Create a virtual FS Map with the lib files from a particular TypeScript
     * version based on the target, Always includes dom ATM.
     *
     * @param options The compiler target, which dictates the libs to set up
     * @param version the versions of TypeScript which are supported
     * @param cache should the values be stored in local storage
     * @param ts a copy of the typescript import
     * @param lzstring an optional copy of the lz-string import
     * @param fetcher an optional replacement for the global fetch function (tests mainly)
     * @param storer an optional replacement for the localStorage global (tests mainly)
     */
    exports.createDefaultMapFromCDN = (options, version, cache, ts, lzstring, fetcher, storer) => {
        const fetchlike = fetcher || fetch;
        const storelike = storer || localStorage;
        const fsMap = new Map();
        const files = exports.knownLibFilesForCompilerOptions(options, ts);
        const prefix = `https://typescript.azureedge.net/cdn/${version}/typescript/lib/`;
        function zip(str) {
            return lzstring ? lzstring.compressToUTF16(str) : str;
        }
        function unzip(str) {
            return lzstring ? lzstring.decompressFromUTF16(str) : str;
        }
        // Map the known libs to a node fetch promise, then return the contents
        function uncached() {
            return Promise.all(files.map(lib => fetchlike(prefix + lib).then(resp => resp.text()))).then(contents => {
                contents.forEach((text, index) => fsMap.set('/' + files[index], text));
            });
        }
        // A localstorage and lzzip aware version of the lib files
        function cached() {
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
                // Remove anything which isn't from this version
                if (key.startsWith('ts-lib-') && !key.startsWith('ts-lib-' + version)) {
                    storelike.removeItem(key);
                }
            });
            return Promise.all(files.map(lib => {
                const cacheKey = `ts-lib-${version}-${lib}`;
                const content = storelike.getItem(cacheKey);
                if (!content) {
                    // Make the API call and store the text concent in the cache
                    return fetchlike(prefix + lib)
                        .then(resp => resp.text())
                        .then(t => {
                        storelike.setItem(cacheKey, zip(t));
                        return t;
                    });
                }
                else {
                    return Promise.resolve(unzip(content));
                }
            })).then(contents => {
                contents.forEach((text, index) => {
                    const name = '/' + files[index];
                    fsMap.set(name, text);
                });
            });
        }
        const func = cache ? cached : uncached;
        return func().then(() => fsMap);
    };
    // TODO: Add some kind of debug logger (needs to be compat with sandbox's deployment, not just via npm)
    function notImplemented(methodName) {
        throw new Error(`Method '${methodName}' is not implemented.`);
    }
    function audit(name, fn) {
        return (...args) => {
            const res = fn(...args);
            const smallres = typeof res === 'string' ? res.slice(0, 80) + '...' : res;
            debugLog('> ' + name, ...args);
            debugLog('< ' + smallres);
            return res;
        };
    }
    /** The default compiler options if TypeScript could ever change the compiler options */
    const defaultCompilerOptions = (ts) => {
        return Object.assign(Object.assign({}, ts.getDefaultCompilerOptions()), { jsx: ts.JsxEmit.React, strict: true, esModuleInterop: true, module: ts.ModuleKind.ESNext, suppressOutputPathCheck: true, skipLibCheck: true, skipDefaultLibCheck: true, moduleResolution: ts.ModuleResolutionKind.NodeJs });
    };
    // "/DOM.d.ts" => "/lib.dom.d.ts"
    const libize = (path) => path.replace('/', '/lib.').toLowerCase();
    /**
     * Creates an in-memory System object which can be used in a TypeScript program, this
     * is what provides read/write aspects of the virtual fs
     */
    function createSystem(files) {
        files = new Map(files);
        return {
            args: [],
            createDirectory: () => notImplemented('createDirectory'),
            // TODO: could make a real file tree
            directoryExists: audit('directoryExists', directory => {
                return Array.from(files.keys()).some(path => path.startsWith(directory));
            }),
            exit: () => notImplemented('exit'),
            fileExists: audit('fileExists', fileName => files.has(fileName) || files.has(libize(fileName))),
            getCurrentDirectory: () => '/',
            getDirectories: () => [],
            getExecutingFilePath: () => notImplemented('getExecutingFilePath'),
            readDirectory: audit('readDirectory', directory => (directory === '/' ? Array.from(files.keys()) : [])),
            readFile: audit('readFile', fileName => files.get(fileName) || files.get(libize(fileName))),
            resolvePath: path => path,
            newLine: '\n',
            useCaseSensitiveFileNames: true,
            write: () => notImplemented('write'),
            writeFile: (fileName, contents) => {
                files.set(fileName, contents);
            },
        };
    }
    exports.createSystem = createSystem;
    /**
     * Creates an in-memory CompilerHost -which is essentially an extra wrapper to System
     * which works with TypeScript objects - returns both a compiler host, and a way to add new SourceFile
     * instances to the in-memory file system.
     */
    function createVirtualCompilerHost(sys, compilerOptions, ts) {
        const sourceFiles = new Map();
        const save = (sourceFile) => {
            sourceFiles.set(sourceFile.fileName, sourceFile);
            return sourceFile;
        };
        const vHost = {
            compilerHost: Object.assign(Object.assign({}, sys), { getCanonicalFileName: fileName => fileName, getDefaultLibFileName: () => '/' + ts.getDefaultLibFileName(compilerOptions), 
                // getDefaultLibLocation: () => '/',
                getDirectories: () => [], getNewLine: () => sys.newLine, getSourceFile: fileName => {
                    return (sourceFiles.get(fileName) ||
                        save(ts.createSourceFile(fileName, sys.readFile(fileName), compilerOptions.target || defaultCompilerOptions(ts).target, false)));
                }, useCaseSensitiveFileNames: () => sys.useCaseSensitiveFileNames }),
            updateFile: sourceFile => {
                const alreadyExists = sourceFiles.has(sourceFile.fileName);
                sys.writeFile(sourceFile.fileName, sourceFile.text);
                sourceFiles.set(sourceFile.fileName, sourceFile);
                return alreadyExists;
            },
        };
        return vHost;
    }
    exports.createVirtualCompilerHost = createVirtualCompilerHost;
    /**
     * Creates an object which can host a language service against the virtual file-system
     */
    function createVirtualLanguageServiceHost(sys, rootFiles, compilerOptions, ts) {
        const fileNames = [...rootFiles];
        const { compilerHost, updateFile } = createVirtualCompilerHost(sys, compilerOptions, ts);
        const fileVersions = new Map();
        let projectVersion = 0;
        const languageServiceHost = Object.assign(Object.assign({}, compilerHost), { getProjectVersion: () => projectVersion.toString(), getCompilationSettings: () => compilerOptions, getScriptFileNames: () => fileNames, getScriptSnapshot: fileName => {
                const contents = sys.readFile(fileName);
                if (contents) {
                    return ts.ScriptSnapshot.fromString(contents);
                }
                return;
            }, getScriptVersion: fileName => {
                return fileVersions.get(fileName) || '0';
            }, writeFile: sys.writeFile });
        const lsHost = {
            languageServiceHost,
            updateFile: sourceFile => {
                projectVersion++;
                fileVersions.set(sourceFile.fileName, projectVersion.toString());
                if (!fileNames.includes(sourceFile.fileName)) {
                    fileNames.push(sourceFile.fileName);
                }
                updateFile(sourceFile);
            },
        };
        return lsHost;
    }
    exports.createVirtualLanguageServiceHost = createVirtualLanguageServiceHost;
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXNjcmlwdC12ZnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zYW5kYm94L3NyYy92ZW5kb3IvdHlwZXNjcmlwdC12ZnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0lBT0EsTUFBTSxlQUFlLEdBQUcsT0FBTyxZQUFZLEtBQUssV0FBVyxDQUFBO0lBQzNELE1BQU0sVUFBVSxHQUFHLE9BQU8sT0FBTyxLQUFLLFdBQVcsQ0FBQTtJQUNqRCxNQUFNLFdBQVcsR0FBRyxDQUFDLGVBQWUsSUFBSSxZQUFZLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUMzRyxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBYyxFQUFFLEdBQUcsZUFBc0IsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFBO0lBVTlGOzs7Ozs7OztPQVFHO0lBRUgsU0FBZ0Isa0NBQWtDLENBQ2hELEdBQVcsRUFDWCxTQUFtQixFQUNuQixFQUFNLEVBQ04sa0JBQW1DLEVBQUU7UUFFckMsTUFBTSxrQkFBa0IsbUNBQVEsc0JBQXNCLENBQUMsRUFBRSxDQUFDLEdBQUssZUFBZSxDQUFFLENBQUE7UUFFaEYsTUFBTSxFQUFFLG1CQUFtQixFQUFFLFVBQVUsRUFBRSxHQUFHLGdDQUFnQyxDQUFDLEdBQUcsRUFBRSxTQUFTLEVBQUUsa0JBQWtCLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFDcEgsTUFBTSxlQUFlLEdBQUcsRUFBRSxDQUFDLHFCQUFxQixDQUFDLG1CQUFtQixDQUFDLENBQUE7UUFDckUsTUFBTSxXQUFXLEdBQUcsZUFBZSxDQUFDLDZCQUE2QixFQUFFLENBQUE7UUFFbkUsSUFBSSxXQUFXLENBQUMsTUFBTSxFQUFFO1lBQ3RCLE1BQU0sWUFBWSxHQUFH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UUFBUSxFQUFFO29CQUNaLE9BQU8sRUFBRSxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUE7aUJBQzlDO2dCQUNELE9BQU07WUFDUixDQUFDLEVBQ0QsZ0JBQWdCLEVBQUUsUUFBUSxDQUFDLEVBQUU7Z0JBQzNCLE9BQU8sWUFBWSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxHQUFHLENBQUE7WUFDMUMsQ0FBQyxFQUNELFNBQVMsRUFBRSxHQUFHLENBQUMsU0FBUyxHQUN6QixDQUFBO1FBT0QsTUFBTSxNQUFNLEdBQVc7WUFDckIsbUJBQW1CO1lBQ25CLFVBQVUsRUFBRSxVQUFVLENBQUMsRUFBRTtnQkFDdkIsY0FBYyxFQUFFLENBQUE7Z0JBQ2hCLFlBQVksQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFBRSxjQUFjLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQTtnQkFDaEUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxFQUFFO29CQUM1QyxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQTtpQkFDcEM7Z0JBQ0QsVUFBVSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3hCLENBQUM7U0FDRixDQUFBO1FBQ0QsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBN0NELDRFQTZDQyIsInNvdXJjZXNDb250ZW50IjpbInR5cGUgU3lzdGVtID0gaW1wb3J0KCd0eXBlc2NyaXB0JykuU3lzdGVtXG50eXBlIENvbXBpbGVyT3B0aW9ucyA9IGltcG9ydCgndHlwZXNjcmlwdCcpLkNvbXBpbGVyT3B0aW9uc1xudHlwZSBMYW5ndWFnZVNlcnZpY2VIb3N0ID0gaW1wb3J0KCd0eXBlc2NyaXB0JykuTGFuZ3VhZ2VTZXJ2aWNlSG9zdFxudHlwZSBDb21waWxlckhvc3QgPSBpbXBvcnQoJ3R5cGVzY3JpcHQnKS5Db21waWxlckhvc3RcbnR5cGUgU291cmNlRmlsZSA9IGltcG9ydCgndHlwZXNjcmlwdCcpLlNvdXJjZUZpbGVcbnR5cGUgVFMgPSB0eXBlb2YgaW1wb3J0KCd0eXBlc2NyaXB0JylcblxuY29uc3QgaGFzTG9jYWxTdG9yYWdlID0gdHlwZW9mIGxvY2FsU3RvcmFnZSAhPT0gYHVuZGVmaW5lZGBcbmNvbnN0IGhhc1Byb2Nlc3MgPSB0eXBlb2YgcHJvY2VzcyAhPT0gYHVuZGVmaW5lZGBcbmNvbnN0IHNob3VsZERlYnVnID0gKGhhc0xvY2FsU3RvcmFnZSAmJiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnREVCVUcnKSkgfHwgKGhhc1Byb2Nlc3MgJiYgcHJvY2Vzcy5lbnYuREVCVUcpXG5jb25zdCBkZWJ1Z0xvZyA9IHNob3VsZERlYnVnID8gY29uc29sZS5sb2cgOiAoX21lc3NhZ2U/OiBhbnksIC4uLl9vcHRpb25hbFBhcmFtczogYW55W10pID0+ICcnXG5cbmV4cG9ydCBpbnRlcmZhY2UgVmlydHVhbFR5cGVTY3JpcHRFbnZpcm9ubWVudCB7XG4gIHN5czogU3lzdGVtXG4gIGxhbmd1YWdlU2VydmljZTogaW1wb3J0KCd0eXBlc2NyaXB0JykuTGFuZ3VhZ2VTZXJ2aWNlXG4gIGdldFNvdXJjZUZpbGU6IChmaWxlTmFtZTogc3RyaW5nKSA9PiBpbXBvcnQoJ3R5cGVzY3JpcHQnKS5Tb3VyY2VGaWxlIHwgdW5kZWZpbmVkXG4gIGNyZWF0ZUZpbGU6IChmaWxlTmFtZTogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpID0+IHZvaWRcbiAgdXBkYXRlRmlsZTogKGZpbGVOYW1lOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZywgcmVwbGFjZVRleHRTcGFuPzogaW1wb3J0KCd0eXBlc2NyaXB0JykuVGV4dFNwYW4pID0+IHZvaWRcbn1cblxuLyoqXG4gKiBNYWtlcyBhIHZpcnR1YWwgY29weSBvZiB0aGUgVHlwZVNjcmlwdCBlbnZpcm9ubWVudC4gVGhpcyBpcyB0aGUgbWFpbiBBUEkgeW91IHdhbnQgdG8gYmUgdXNpbmcgd2l0aFxuICogdHlwZXNjcmlwdC12ZnMuIEEgbG90IG9mIHRoZSBvdGhlciBleHBvc2VkIGZ1bmN0aW9ucyBhcmUgdXNlZCBieSB0aGlzIGZ1bmN0aW9uIHRvIGdldCBzZXQgdXAuXG4gKlxuICogQHBhcmFtIHN5cyBhbiBvYmplY3Qgd2hpY2ggY29uZm9ybXMgdG8gdGhlIFRTIFN5cyAoYSBzaGltIG92ZXIgcmVhZC93cml0ZSBhY2Nlc3MgdG8gdGhlIGZzKVxuICogQHBhcmFtIHJvb3RGaWxlcyBhIGxpc3Qgb2YgZmlsZXMgd2hpY2ggYXJlIGNvbnNpZGVyZWQgaW5zaWRlIHRoZSBwcm9qZWN0XG4gKiBAcGFyYW0gdHMgYSBjb3B5IHBmIHRoZSBUeXBlU2NyaXB0IG1vZHVsZVxuICogQHBhcmFtIGNvbXBpbGVyT3B0aW9ucyB0aGUgb3B0aW9ucyBmb3IgdGhpcyBjb21waWxlciBydW5cbiAqL1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVmlydHVhbFR5cGVTY3JpcHRFbnZpcm9ubWVudChcbiAgc3lzOiBTeXN0ZW0sXG4gIHJvb3RGaWxlczogc3RyaW5nW10sXG4gIHRzOiBUUyxcbiAgY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnMgPSB7fVxuKTogVmlydHVhbFR5cGVTY3JpcHRFbnZpcm9ubWVudCB7XG4gIGNvbnN0IG1lcmdlZENvbXBpbGVyT3B0cyA9IHsgLi4uZGVmYXVsdENvbXBpbGVyT3B0aW9ucyh0cyksIC4uLmNvbXBpbGVyT3B0aW9ucyB9XG5cbiAgY29uc3QgeyBsYW5ndWFnZVNlcnZpY2VIb3N0LCB1cGRhdGVGaWxlIH0gPSBjcmVhdGVWaXJ0dWFsTGFuZ3VhZ2VTZXJ2aWNlSG9zdChzeXMsIHJvb3RGaWxlcywgbWVyZ2VkQ29tcGlsZXJPcHRzLCB0cylcbiAgY29uc3QgbGFuZ3VhZ2VTZXJ2aWNlID0gdHMuY3JlYXRlTGFuZ3VhZ2VTZXJ2aWNlKGxhbmd1YWdlU2VydmljZUhvc3QpXG4gIGNvbnN0IGRpYWdub3N0aWNzID0gbGFuZ3VhZ2VTZXJ2aWNlLmdldENvbXBpbGVyT3B0aW9uc0RpYWdub3N0aWNzKClcblxuICBpZiAoZGlhZ25vc3RpY3MubGVuZ3RoKSB7XG4gICAgY29uc3QgY29tcGlsZXJIb3N0ID0gY3JlYXRlVmlydHVhbENvbXBpbGVySG9zdChzeXMsIGNvbXBpbGVyT3B0aW9ucywgdHMpXG4gICAgdGhyb3cgbmV3IEVycm9yKHRzLmZvcm1hdERpYWdub3N0aWNzKGRpYWdub3N0aWNzLCBjb21waWxlckhvc3QuY29tcGlsZXJIb3N0KSlcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3lzLFxuICAgIGxhbmd1YWdlU2VydmljZSxcbiAgICBnZXRTb3VyY2VGaWxlOiBmaWxlTmFtZSA9PiBsYW5ndWFnZVNlcnZpY2UuZ2V0UHJvZ3JhbSgpPy5nZXRTb3VyY2VGaWxlKGZpbGVOYW1lKSxcblxuICAgIGNyZWF0ZUZpbGU6IChmaWxlTmFtZSwgY29udGVudCkgPT4ge1xuICAgICAgdXBkYXRlRmlsZSh0cy5jcmVhdGVTb3VyY2VGaWxlKGZpbGVOYW1lLCBjb250ZW50LCBtZXJnZWRDb21waWxlck9wdHMudGFyZ2V0ISwgZmFsc2UpKVxuICAgIH0sXG4gICAgdXBkYXRlRmlsZTogKGZpbGVOYW1lLCBjb250ZW50LCBvcHRQcmV2VGV4dFNwYW4pID0+IHtcbiAgICAgIGNvbnN0IHByZXZTb3VyY2VGaWxlID0gbGFuZ3VhZ2VTZXJ2aWNlLmdldFByb2dyYW0oKSEuZ2V0U291cmNlRmlsZShmaWxlTmFtZSkhXG4gICAgICBjb25zdCBwcmV2RnVsbENvbnRlbnRzID0gcHJldlNvdXJjZUZpbGUudGV4dFxuXG4gICAgICAvLyBUT0RPOiBWYWxpZGF0ZSBpZiB0aGUgZGVmYXVsdCB0ZXh0IHNwYW4gaGFzIGEgZmVuY2Vwb3N0IGVycm9yP1xuICAgICAgY29uc3QgcHJldlRleHRTcGFuID0gb3B0UHJldlRleHRTcGFuID8/IHRzLmNyZWF0ZVRleHRTcGFuKDAsIHByZXZGdWxsQ29udGVudHMubGVuZ3RoKVxuICAgICAgY29uc3QgbmV3VGV4dCA9XG4gICAgICAgIHByZXZGdWxsQ29udGVudHMuc2xpY2UoMCwgcHJldlRleHRTcGFuLnN0YXJ0KSArXG4gICAgICAgIGNvbnRlbnQgK1xuICAgICAgICBwcmV2RnVsbENvbnRlbnRzLnNsaWNlKHByZXZUZXh0U3Bhbi5zdGFydCArIHByZXZUZXh0U3Bhbi5sZW5ndGgpXG4gICAgICBjb25zdCBuZXdTb3VyY2VGaWxlID0gdHMudXBkYXRlU291cmNlRmlsZShwcmV2U291cmNlRmlsZSwgbmV3VGV4dCwge1xuICAgICAgICBzcGFuOiBwcmV2VGV4dFNwYW4sXG4gICAgICAgIG5ld0xlbmd0aDogY29udGVudC5sZW5ndGgsXG4gICAgICB9KVxuXG4gICAgICB1cGRhdGVGaWxlKG5ld1NvdXJjZUZpbGUpXG4gICAgfSxcbiAgfVxufVxuXG4vKipcbiAqIEdyYWIgdGhlIGxpc3Qgb2YgbGliIGZpbGVzIGZvciBhIHBhcnRpY3VsYXIgdGFyZ2V0LCB3aWxsIHJldHVybiBhIGJpdCBtb3JlIHRoYW4gbmVjZXNzYXJ5IChieSBpbmNsdWRpbmdcbiAqIHRoZSBkb20pIGJ1dCB0aGF0J3MgT0tcbiAqXG4gKiBAcGFyYW0gdGFyZ2V0IFRoZSBjb21waWxlciBzZXR0aW5ncyB0YXJnZXQgYmFzZWxpbmVcbiAqIEBwYXJhbSB0cyBBIGNvcHkgb2YgdGhlIFR5cGVTY3JpcHQgbW9kdWxlXG4gKi9cbmV4cG9ydCBjb25zdCBrbm93bkxpYkZpbGVzRm9yQ29tcGlsZXJPcHRpb25zID0gKGNvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zLCB0czogVFMpID0+IHtcbiAgY29uc3QgdGFyZ2V0ID0gY29tcGlsZXJPcHRpb25zLnRhcmdldCB8fCB0cy5TY3JpcHRUYXJnZXQuRVM1XG4gIGNvbnN0IGxpYiA9IGNvbXBpbGVyT3B0aW9ucy5saWIgfHwgW11cblxuICBjb25zdCBmaWxlcyA9IFtcbiAgICAnbGliLmQudHMnLFxuICAgICdsaWIuZG9tLmQudHMnLFxuICAgICdsaWIuZG9tLml0ZXJhYmxlLmQudHMnLFxuICAgICdsaWIud2Vid29ya2VyLmQudHMnLFxuICAgICdsaWIud2Vid29ya2VyLmltcG9ydHNjcmlwdHMuZC50cycsXG4gICAgJ2xpYi5zY3JpcHRob3N0LmQudHMnLFxuICAgICdsaWIuZXM1LmQudHMnLFxuICAgICdsaWIuZXM2LmQudHMnLFxuICAgICdsaWIuZXMyMDE1LmNvbGxlY3Rpb24uZC50cycsXG4gICAgJ2xpYi5lczIwMTUuY29yZS5kLnRzJyxcbiAgICAnbGliLmVzMjAxNS5kLnRzJyxcbiAgICAnbGliLmVzMjAxNS5nZW5lcmF0b3IuZC50cycsXG4gICAgJ2xpYi5lczIwMTUuaXRlcmFibGUuZC50cycsXG4gICAgJ2xpYi5lczIwMTUucHJvbWlzZS5kLnRzJyxcbiAgICAnbGliLmVzMjAxNS5wcm94eS5kLnRzJyxcbiAgICAnbGliLmVzMjAxNS5yZWZsZWN0LmQudHMnLFxuICAgICdsaWIuZXMyMDE1LnN5bWJvbC5kLnRzJyxcbiAgICAnbGliLmVzMjAxNS5zeW1ib2wud2VsbGtub3duLmQudHMnLFxuICAgICdsaWIuZXMyMDE2LmFycmF5LmluY2x1ZGUuZC50cycsXG4gICAgJ2xpYi5lczIwMTYuZC50cycsXG4gICAgJ2xpYi5lczIwMTYuZnVsbC5kLnRzJyxcbiAgICAnbGliLmVzMjAxNy5kLnRzJyxcbiAgICAnbGliLmVzMjAxNy5mdWxsLmQudHMnLFxuICAgICdsaWIuZXMyMDE3LmludGwuZC50cycsXG4gICAgJ2xpYi5lczIwMTcub2JqZWN0LmQudHMnLFxuICAgICdsaWIuZXMyMDE3LnNoYXJlZG1lbW9yeS5kLnRzJyxcbiAgICAnbGliLmVzMjAxNy5zdHJpbmcuZC50cycsXG4gICAgJ2xpYi5lczIwMTcudHlwZWRhcnJheXMuZC50cycsXG4gICAgJ2xpYi5lczIwMTguYXN5bmNnZW5lcmF0b3IuZC50cycsXG4gICAgJ2xpYi5lczIwMTguYXN5bmNpdGVyYWJsZS5kLnRzJyxcbiAgICAnbGliLmVzMjAxOC5kLnRzJyxcbiAgICAnbGliLmVzMjAxOC5mdWxsLmQudHMnLFxuICAgICdsaWIuZXMyMDE4LmludGwuZC50cycsXG4gICAgJ2xpYi5lczIwMTgucHJvbWlzZS5kLnRzJyxcbiAgICAnbGliLmVzMjAxOC5yZWdleHAuZC50cycsXG4gICAgJ2xpYi5lczIwMTkuYXJyYXkuZC50cycsXG4gICAgJ2xpYi5lczIwMTkuZC50cycsXG4gICAgJ2xpYi5lczIwMTkuZnVsbC5kLnRzJyxcbiAgICAnbGliLmVzMjAxOS5vYmplY3QuZC50cycsXG4gICAgJ2xpYi5lczIwMTkuc3RyaW5nLmQudHMnLFxuICAgICdsaWIuZXMyMDE5LnN5bWJvbC5kLnRzJyxcbiAgICAnbGliLmVzMjAyMC5kLnRzJyxcbiAgICAnbGliLmVzMjAyMC5mdWxsLmQudHMnLFxuICAgICdsaWIuZXMyMDIwLnN0cmluZy5kLnRzJyxcbiAgICAnbGliLmVzMjAyMC5zeW1ib2wud2VsbGtub3duLmQudHMnLFxuICAgICdsaWIuZXNuZXh0LmFycmF5LmQudHMnLFxuICAgICdsaWIuZXNuZXh0LmFzeW5jaXRlcmFibGUuZC50cycsXG4gICAgJ2xpYi5lc25leHQuYmlnaW50LmQudHMnLFxuICAgICdsaWIuZXNuZXh0LmQudHMnLFxuICAgICdsaWIuZXNuZXh0LmZ1bGwuZC50cycsXG4gICAgJ2xpYi5lc25leHQuaW50bC5kLnRzJyxcbiAgICAnbGliLmVzbmV4dC5zeW1ib2wuZC50cycsXG4gIF1cblxuICBjb25zdCB0YXJnZXRUb0N1dCA9IHRzLlNjcmlwdFRhcmdldFt0YXJnZXRdXG4gIGNvbnN0IG1hdGNoZXMgPSBmaWxlcy5maWx0ZXIoZiA9PiBmLnN0YXJ0c1dpdGgoYGxpYi4ke3RhcmdldFRvQ3V0LnRvTG93ZXJDYXNlKCl9YCkpXG4gIGNvbnN0IHRhcmdldEN1dEluZGV4ID0gZmlsZXMuaW5kZXhPZihtYXRjaGVzLnBvcCgpISlcblxuICBjb25zdCBnZXRNYXggPSAoYXJyYXk6IG51bWJlcltdKSA9PlxuICAgIGFycmF5ICYmIGFycmF5Lmxlbmd0aCA/IGFycmF5LnJlZHVjZSgobWF4LCBjdXJyZW50KSA9PiAoY3VycmVudCA+IG1heCA/IGN1cnJlbnQgOiBtYXgpKSA6IHVuZGVmaW5lZFxuXG4gIC8vIEZpbmQgdGhlIGluZGV4IGZvciBldmVyeXRoaW5nIGluXG4gIGNvbnN0IGluZGV4ZXNGb3JDdXR0aW5nID0gbGliLm1hcChsaWIgPT4ge1xuICAgIGNvbnN0IG1hdGNoZXMgPSBmaWxlcy5maWx0ZXIoZiA9PiBmLnN0YXJ0c1dpdGgoYGxpYi4ke2xpYi50b0xvd2VyQ2FzZSgpfWApKVxuICAgIGlmIChtYXRjaGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcblxuICAgIGNvbnN0IGN1dEluZGV4ID0gZmlsZXMuaW5kZXhPZihtYXRjaGVzLnBvcCgpISlcbiAgICByZXR1cm4gY3V0SW5kZXhcbiAgfSlcblxuICBjb25zdCBsaWJDdXRJbmRleCA9IGdldE1heChpbmRleGVzRm9yQ3V0dGluZykgfHwgMFxuXG4gIGNvbnN0IGZpbmFsQ3V0SW5kZXggPSBNYXRoLm1heCh0YXJnZXRDdXRJbmRleCwgbGliQ3V0SW5kZXgpXG4gIHJldHVybiBmaWxlcy5zbGljZSgwLCBmaW5hbEN1dEluZGV4ICsgMSlcbn1cblxuLyoqXG4gKiBTZXRzIHVwIGEgTWFwIHdpdGggbGliIGNvbnRlbnRzIGJ5IGdyYWJiaW5nIHRoZSBuZWNlc3NhcnkgZmlsZXMgZnJvbVxuICogdGhlIGxvY2FsIGNvcHkgb2YgdHlwZXNjcmlwdCB2aWEgdGhlIGZpbGUgc3lzdGVtLlxuICovXG5leHBvcnQgY29uc3QgY3JlYXRlRGVmYXVsdE1hcEZyb21Ob2RlTW9kdWxlcyA9IChjb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucykgPT4ge1xuICBjb25zdCB0cyA9IHJlcXVpcmUoJ3R5cGVzY3JpcHQnKVxuICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpXG4gIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKVxuXG4gIGNvbnN0IGdldExpYiA9IChuYW1lOiBzdHJpbmcpID0+IHtcbiAgICBjb25zdCBsaWIgPSBwYXRoLmRpcm5hbWUocmVxdWlyZS5yZXNvbHZlKCd0eXBlc2NyaXB0JykpXG4gICAgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhwYXRoLmpvaW4obGliLCBuYW1lKSwgJ3V0ZjgnKVxuICB9XG5cbiAgY29uc3QgbGlicyA9IGtub3duTGliRmlsZXNGb3JDb21waWxlck9wdGlvbnMoY29tcGlsZXJPcHRpb25zLCB0cylcbiAgY29uc3QgZnNNYXAgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG4gIGxpYnMuZm9yRWFjaChsaWIgPT4ge1xuICAgIGZzTWFwLnNldCgnLycgKyBsaWIsIGdldExpYihsaWIpKVxuICB9KVxuICByZXR1cm4gZnNNYXBcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSB2aXJ0dWFsIEZTIE1hcCB3aXRoIHRoZSBsaWIgZmlsZXMgZnJvbSBhIHBhcnRpY3VsYXIgVHlwZVNjcmlwdFxuICogdmVyc2lvbiBiYXNlZCBvbiB0aGUgdGFyZ2V0LCBBbHdheXMgaW5jbHVkZXMgZG9tIEFUTS5cbiAqXG4gKiBAcGFyYW0gb3B0aW9ucyBUaGUgY29tcGlsZXIgdGFyZ2V0LCB3aGljaCBkaWN0YXRlcyB0aGUgbGlicyB0byBzZXQgdXBcbiAqIEBwYXJhbSB2ZXJzaW9uIHRoZSB2ZXJzaW9ucyBvZiBUeXBlU2NyaXB0IHdoaWNoIGFyZSBzdXBwb3J0ZWRcbiAqIEBwYXJhbSBjYWNoZSBzaG91bGQgdGhlIHZhbHVlcyBiZSBzdG9yZWQgaW4gbG9jYWwgc3RvcmFnZVxuICogQHBhcmFtIHRzIGEgY29weSBvZiB0aGUgdHlwZXNjcmlwdCBpbXBvcnRcbiAqIEBwYXJhbSBsenN0cmluZyBhbiBvcHRpb25hbCBjb3B5IG9mIHRoZSBsei1zdHJpbmcgaW1wb3J0XG4gKiBAcGFyYW0gZmV0Y2hlciBhbiBvcHRpb25hbCByZXBsYWNlbWVudCBmb3IgdGhlIGdsb2JhbCBmZXRjaCBmdW5jdGlvbiAodGVzdHMgbWFpbmx5KVxuICogQHBhcmFtIHN0b3JlciBhbiBvcHRpb25hbCByZXBsYWNlbWVudCBmb3IgdGhlIGxvY2FsU3RvcmFnZSBnbG9iYWwgKHRlc3RzIG1haW5seSlcbiAqL1xuZXhwb3J0IGNvbnN0IGNyZWF0ZURlZmF1bHRNYXBGcm9tQ0ROID0gKFxuICBvcHRpb25zOiBDb21waWxlck9wdGlvbnMsXG4gIHZlcnNpb246IHN0cmluZyxcbiAgY2FjaGU6IGJvb2xlYW4sXG4gIHRzOiBUUyxcbiAgbHpzdHJpbmc/OiB0eXBlb2YgaW1wb3J0KCdsei1zdHJpbmcnKSxcbiAgZmV0Y2hlcj86IHR5cGVvZiBmZXRjaCxcbiAgc3RvcmVyPzogdHlwZW9mIGxvY2FsU3RvcmFnZVxuKSA9PiB7XG4gIGNvbnN0IGZldGNobGlrZSA9IGZldGNoZXIgfHwgZmV0Y2hcbiAgY29uc3Qgc3RvcmVsaWtlID0gc3RvcmVyIHx8IGxvY2FsU3RvcmFnZVxuICBjb25zdCBmc01hcCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcbiAgY29uc3QgZmlsZXMgPSBrbm93bkxpYkZpbGVzRm9yQ29tcGlsZXJPcHRpb25zKG9wdGlvbnMsIHRzKVxuICBjb25zdCBwcmVmaXggPSBgaHR0cHM6Ly90eXBlc2NyaXB0LmF6dXJlZWRnZS5uZXQvY2RuLyR7dmVyc2lvbn0vdHlwZXNjcmlwdC9saWIvYFxuXG4gIGZ1bmN0aW9uIHppcChzdHI6IHN0cmluZykge1xuICAgIHJldHVybiBsenN0cmluZyA/IGx6c3RyaW5nLmNvbXByZXNzVG9VVEYxNihzdHIpIDogc3RyXG4gIH1cblxuICBmdW5jdGlvbiB1bnppcChzdHI6IHN0cmluZykge1xuICAgIHJldHVybiBsenN0cmluZyA/IGx6c3RyaW5nLmRlY29tcHJlc3NGcm9tVVRGMTYoc3RyKSA6IHN0clxuICB9XG5cbiAgLy8gTWFwIHRoZSBrbm93biBsaWJzIHRvIGEgbm9kZSBmZXRjaCBwcm9taXNlLCB0aGVuIHJldHVybiB0aGUgY29udGVudHNcbiAgZnVuY3Rpb24gdW5jYWNoZWQoKSB7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKGZpbGVzLm1hcChsaWIgPT4gZmV0Y2hsaWtlKHByZWZpeCArIGxpYikudGhlbihyZXNwID0+IHJlc3AudGV4dCgpKSkpLnRoZW4oY29udGVudHMgPT4ge1xuICAgICAgY29udGVudHMuZm9yRWFjaCgodGV4dCwgaW5kZXgpID0+IGZzTWFwLnNldCgnLycgKyBmaWxlc1tpbmRleF0sIHRleHQpKVxuICAgIH0pXG4gIH1cblxuICAvLyBBIGxvY2Fsc3RvcmFnZSBhbmQgbHp6aXAgYXdhcmUgdmVyc2lvbiBvZiB0aGUgbGliIGZpbGVzXG4gIGZ1bmN0aW9uIGNhY2hlZCgpIHtcbiAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMobG9jYWxTdG9yYWdlKVxuICAgIGtleXMuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgLy8gUmVtb3ZlIGFueXRoaW5nIHdoaWNoIGlzbid0IGZyb20gdGhpcyB2ZXJzaW9uXG4gICAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoJ3RzLWxpYi0nKSAmJiAha2V5LnN0YXJ0c1dpdGgoJ3RzLWxpYi0nICsgdmVyc2lvbikpIHtcbiAgICAgICAgc3RvcmVsaWtlLnJlbW92ZUl0ZW0oa2V5KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoXG4gICAgICBmaWxlcy5tYXAobGliID0+IHtcbiAgICAgICAgY29uc3QgY2FjaGVLZXkgPSBgdHMtbGliLSR7dmVyc2lvbn0tJHtsaWJ9YFxuICAgICAgICBjb25zdCBjb250ZW50ID0gc3RvcmVsaWtlLmdldEl0ZW0oY2FjaGVLZXkpXG5cbiAgICAgICAgaWYgKCFjb250ZW50KSB7XG4gICAgICAgICAgLy8gTWFrZSB0aGUgQVBJIGNhbGwgYW5kIHN0b3JlIHRoZSB0ZXh0IGNvbmNlbnQgaW4gdGhlIGNhY2hlXG4gICAgICAgICAgcmV0dXJuIGZldGNobGlrZShwcmVmaXggKyBsaWIpXG4gICAgICAgICAgICAudGhlbihyZXNwID0+IHJlc3AudGV4dCgpKVxuICAgICAgICAgICAgLnRoZW4odCA9PiB7XG4gICAgICAgICAgICAgIHN0b3JlbGlrZS5zZXRJdGVtKGNhY2hlS2V5LCB6aXAodCkpXG4gICAgICAgICAgICAgIHJldHVybiB0XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUodW56aXAoY29udGVudCkpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKS50aGVuKGNvbnRlbnRzID0+IHtcbiAgICAgIGNvbnRlbnRzLmZvckVhY2goKHRleHQsIGluZGV4KSA9PiB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSAnLycgKyBmaWxlc1tpbmRleF1cbiAgICAgICAgZnNNYXAuc2V0KG5hbWUsIHRleHQpXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICBjb25zdCBmdW5jID0gY2FjaGUgPyBjYWNoZWQgOiB1bmNhY2hlZFxuICByZXR1cm4gZnVuYygpLnRoZW4oKCkgPT4gZnNNYXApXG59XG5cbi8vIFRPRE86IEFkZCBzb21lIGtpbmQgb2YgZGVidWcgbG9nZ2VyIChuZWVkcyB0byBiZSBjb21wYXQgd2l0aCBzYW5kYm94J3MgZGVwbG95bWVudCwgbm90IGp1c3QgdmlhIG5wbSlcblxuZnVuY3Rpb24gbm90SW1wbGVtZW50ZWQobWV0aG9kTmFtZTogc3RyaW5nKTogYW55IHtcbiAgdGhyb3cgbmV3IEVycm9yKGBNZXRob2QgJyR7bWV0aG9kTmFtZX0nIGlzIG5vdCBpbXBsZW1lbnRlZC5gKVxufVxuXG5mdW5jdGlvbiBhdWRpdDxBcmdzVCBleHRlbmRzIGFueVtdLCBSZXR1cm5UPihcbiAgbmFtZTogc3RyaW5nLFxuICBmbjogKC4uLmFyZ3M6IEFyZ3NUKSA9PiBSZXR1cm5UXG4pOiAoLi4uYXJnczogQXJnc1QpID0+IFJldHVyblQge1xuICByZXR1cm4gKC4uLmFyZ3MpID0+IHtcbiAgICBjb25zdCByZXMgPSBmbiguLi5hcmdzKVxuXG4gICAgY29uc3Qgc21hbGxyZXMgPSB0eXBlb2YgcmVzID09PSAnc3RyaW5nJyA/IHJlcy5zbGljZSgwLCA4MCkgKyAnLi4uJyA6IHJlc1xuICAgIGRlYnVnTG9nKCc+ICcgKyBuYW1lLCAuLi5hcmdzKVxuICAgIGRlYnVnTG9nKCc8ICcgKyBzbWFsbHJlcylcblxuICAgIHJldHVybiByZXNcbiAgfVxufVxuXG4vKiogVGhlIGRlZmF1bHQgY29tcGlsZXIgb3B0aW9ucyBpZiBUeXBlU2NyaXB0IGNvdWxkIGV2ZXIgY2hhbmdlIHRoZSBjb21waWxlciBvcHRpb25zICovXG5jb25zdCBkZWZhdWx0Q29tcGlsZXJPcHRpb25zID0gKHRzOiB0eXBlb2YgaW1wb3J0KCd0eXBlc2NyaXB0JykpOiBDb21waWxlck9wdGlvbnMgPT4ge1xuICByZXR1cm4ge1xuICAgIC4uLnRzLmdldERlZmF1bHRDb21waWxlck9wdGlvbnMoKSxcbiAgICBqc3g6IHRzLkpzeEVtaXQuUmVhY3QsXG4gICAgc3RyaWN0OiB0cnVlLFxuICAgIGVzTW9kdWxlSW50ZXJvcDogdHJ1ZSxcbiAgICBtb2R1bGU6IHRzLk1vZHVsZUtpbmQuRVNOZXh0LFxuICAgIHN1cHByZXNzT3V0cHV0UGF0aENoZWNrOiB0cnVlLFxuICAgIHNraXBMaWJDaGVjazogdHJ1ZSxcbiAgICBza2lwRGVmYXVsdExpYkNoZWNrOiB0cnVlLFxuICAgIG1vZHVsZVJlc29sdXRpb246IHRzLk1vZHVsZVJlc29sdXRpb25LaW5kLk5vZGVKcyxcbiAgfVxufVxuXG4vLyBcIi9ET00uZC50c1wiID0+IFwiL2xpYi5kb20uZC50c1wiXG5jb25zdCBsaWJpemUgPSAocGF0aDogc3RyaW5nKSA9PiBwYXRoLnJlcGxhY2UoJy8nLCAnL2xpYi4nKS50b0xvd2VyQ2FzZSgpXG5cbi8qKlxuICogQ3JlYXRlcyBhbiBpbi1tZW1vcnkgU3lzdGVtIG9iamVjdCB3aGljaCBjYW4gYmUgdXNlZCBpbiBhIFR5cGVTY3JpcHQgcHJvZ3JhbSwgdGhpc1xuICogaXMgd2hhdCBwcm92aWRlcyByZWFkL3dyaXRlIGFzcGVjdHMgb2YgdGhlIHZpcnR1YWwgZnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVN5c3RlbShmaWxlczogTWFwPHN0cmluZywgc3RyaW5nPik6IFN5c3RlbSB7XG4gIGZpbGVzID0gbmV3IE1hcChmaWxlcylcbiAgcmV0dXJuIHtcbiAgICBhcmdzOiBbXSxcbiAgICBjcmVhdGVEaXJlY3Rvcnk6ICgpID0+IG5vdEltcGxlbWVudGVkKCdjcmVhdGVEaXJlY3RvcnknKSxcbiAgICAvLyBUT0RPOiBjb3VsZCBtYWtlIGEgcmVhbCBmaWxlIHRyZWVcbiAgICBkaXJlY3RvcnlFeGlzdHM6IGF1ZGl0KCdkaXJlY3RvcnlFeGlzdHMnLCBkaXJlY3RvcnkgPT4ge1xuICAgICAgcmV0dXJuIEFycmF5LmZyb20oZmlsZXMua2V5cygpKS5zb21lKHBhdGggPT4gcGF0aC5zdGFydHNXaXRoKGRpcmVjdG9yeSkpXG4gICAgfSksXG4gICAgZXhpdDogKCkgPT4gbm90SW1wbGVtZW50ZWQoJ2V4aXQnKSxcbiAgICBmaWxlRXhpc3RzOiBhdWRpdCgnZmlsZUV4aXN0cycsIGZpbGVOYW1lID0+IGZpbGVzLmhhcyhmaWxlTmFtZSkgfHwgZmlsZXMuaGFzKGxpYml6ZShmaWxlTmFtZSkpKSxcbiAgICBnZXRDdXJyZW50RGlyZWN0b3J5OiAoKSA9PiAnLycsXG4gICAgZ2V0RGlyZWN0b3JpZXM6ICgpID0+IFtdLFxuICAgIGdldEV4ZWN1dGluZ0ZpbGVQYXRoOiAoKSA9PiBub3RJbXBsZW1lbnRlZCgnZ2V0RXhlY3V0aW5nRmlsZVBhdGgnKSxcbiAgICByZWFkRGlyZWN0b3J5OiBhdWRpdCgncmVhZERpcmVjdG9yeScsIGRpcmVjdG9yeSA9PiAoZGlyZWN0b3J5ID09PSAnLycgPyBBcnJheS5mcm9tKGZpbGVzLmtleXMoKSkgOiBbXSkpLFxuICAgIHJlYWRGaWxlOiBhdWRpdCgncmVhZEZpbGUnLCBmaWxlTmFtZSA9PiBmaWxlcy5nZXQoZmlsZU5hbWUpIHx8IGZpbGVzLmdldChsaWJpemUoZmlsZU5hbWUpKSksXG4gICAgcmVzb2x2ZVBhdGg6IHBhdGggPT4gcGF0aCxcbiAgICBuZXdMaW5lOiAnXFxuJyxcbiAgICB1c2VDYXNlU2Vuc2l0aXZlRmlsZU5hbWVzOiB0cnVlLFxuICAgIHdyaXRlOiAoKSA9PiBub3RJbXBsZW1lbnRlZCgnd3JpdGUnKSxcbiAgICB3cml0ZUZpbGU6IChmaWxlTmFtZSwgY29udGVudHMpID0+IHtcbiAgICAgIGZpbGVzLnNldChmaWxlTmFtZSwgY29udGVudHMpXG4gICAgfSxcbiAgfVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gaW4tbWVtb3J5IENvbXBpbGVySG9zdCAtd2hpY2ggaXMgZXNzZW50aWFsbHkgYW4gZXh0cmEgd3JhcHBlciB0byBTeXN0ZW1cbiAqIHdoaWNoIHdvcmtzIHdpdGggVHlwZVNjcmlwdCBvYmplY3RzIC0gcmV0dXJucyBib3RoIGEgY29tcGlsZXIgaG9zdCwgYW5kIGEgd2F5IHRvIGFkZCBuZXcgU291cmNlRmlsZVxuICogaW5zdGFuY2VzIHRvIHRoZSBpbi1tZW1vcnkgZmlsZSBzeXN0ZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVWaXJ0dWFsQ29tcGlsZXJIb3N0KHN5czogU3lzdGVtLCBjb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucywgdHM6IFRTKSB7XG4gIGNvbnN0IHNvdXJjZUZpbGVzID0gbmV3IE1hcDxzdHJpbmcsIFNvdXJjZUZpbGU+KClcbiAgY29uc3Qgc2F2ZSA9IChzb3VyY2VGaWxlOiBTb3VyY2VGaWxlKSA9PiB7XG4gICAgc291cmNlRmlsZXMuc2V0KHNvdXJjZUZpbGUuZmlsZU5hbWUsIHNvdXJjZUZpbGUpXG4gICAgcmV0dXJuIHNvdXJjZUZpbGVcbiAgfVxuXG4gIHR5cGUgUmV0dXJuID0ge1xuICAgIGNvbXBpbGVySG9zdDogQ29tcGlsZXJIb3N0XG4gICAgdXBkYXRlRmlsZTogKHNvdXJjZUZpbGU6IFNvdXJjZUZpbGUpID0+IGJvb2xlYW5cbiAgfVxuXG4gIGNvbnN0IHZIb3N0OiBSZXR1cm4gPSB7XG4gICAgY29tcGlsZXJIb3N0OiB7XG4gICAgICAuLi5zeXMsXG4gICAgICBnZXRDYW5vbmljYWxGaWxlTmFtZTogZmlsZU5hbWUgPT4gZmlsZU5hbWUsXG4gICAgICBnZXREZWZhdWx0TGliRmlsZU5hbWU6ICgpID0+ICcvJyArIHRzLmdldERlZmF1bHRMaWJGaWxlTmFtZShjb21waWxlck9wdGlvbnMpLCAvLyAnL2xpYi5kLnRzJyxcbiAgICAgIC8vIGdldERlZmF1bHRMaWJMb2NhdGlvbjogKCkgPT4gJy8nLFxuICAgICAgZ2V0RGlyZWN0b3JpZXM6ICgpID0+IFtdLFxuICAgICAgZ2V0TmV3TGluZTogKCkgPT4gc3lzLm5ld0xpbmUsXG4gICAgICBnZXRTb3VyY2VGaWxlOiBmaWxlTmFtZSA9PiB7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgc291cmNlRmlsZXMuZ2V0KGZpbGVOYW1lKSB8fFxuICAgICAgICAgIHNhdmUoXG4gICAgICAgICAgICB0cy5jcmVhdGVTb3VyY2VGaWxlKFxuICAgICAgICAgICAgICBmaWxlTmFtZSxcbiAgICAgICAgICAgICAgc3lzLnJlYWRGaWxlKGZpbGVOYW1lKSEsXG4gICAgICAgICAgICAgIGNvbXBpbGVyT3B0aW9ucy50YXJnZXQgfHwgZGVmYXVsdENvbXBpbGVyT3B0aW9ucyh0cykudGFyZ2V0ISxcbiAgICAgICAgICAgICAgZmFsc2VcbiAgICAgICAgICAgIClcbiAgICAgICAgICApXG4gICAgICAgIClcbiAgICAgIH0sXG4gICAgICB1c2VDYXNlU2Vuc2l0aXZlRmlsZU5hbWVzOiAoKSA9PiBzeXMudXNlQ2FzZVNlbnNpdGl2ZUZpbGVOYW1lcyxcbiAgICB9LFxuICAgIHVwZGF0ZUZpbGU6IHNvdXJjZUZpbGUgPT4ge1xuICAgICAgY29uc3QgYWxyZWFkeUV4aXN0cyA9IHNvdXJjZUZpbGVzLmhhcyhzb3VyY2VGaWxlLmZpbGVOYW1lKVxuICAgICAgc3lzLndyaXRlRmlsZShzb3VyY2VGaWxlLmZpbGVOYW1lLCBzb3VyY2VGaWxlLnRleHQpXG4gICAgICBzb3VyY2VGaWxlcy5zZXQoc291cmNlRmlsZS5maWxlTmFtZSwgc291cmNlRmlsZSlcbiAgICAgIHJldHVybiBhbHJlYWR5RXhpc3RzXG4gICAgfSxcbiAgfVxuICByZXR1cm4gdkhvc3Rcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIG9iamVjdCB3aGljaCBjYW4gaG9zdCBhIGxhbmd1YWdlIHNlcnZpY2UgYWdhaW5zdCB0aGUgdmlydHVhbCBmaWxlLXN5c3RlbVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVmlydHVhbExhbmd1YWdlU2VydmljZUhvc3QoXG4gIHN5czogU3lzdGVtLFxuICByb290RmlsZXM6IHN0cmluZ1tdLFxuICBjb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucyxcbiAgdHM6IFRTXG4pIHtcbiAgY29uc3QgZmlsZU5hbWVzID0gWy4uLnJvb3RGaWxlc11cbiAgY29uc3QgeyBjb21waWxlckhvc3QsIHVwZGF0ZUZpbGUgfSA9IGNyZWF0ZVZpcnR1YWxDb21waWxlckhvc3Qoc3lzLCBjb21waWxlck9wdGlvbnMsIHRzKVxuICBjb25zdCBmaWxlVmVyc2lvbnMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpXG4gIGxldCBwcm9qZWN0VmVyc2lvbiA9IDBcbiAgY29uc3QgbGFuZ3VhZ2VTZXJ2aWNlSG9zdDogTGFuZ3VhZ2VTZXJ2aWNlSG9zdCA9IHtcbiAgICAuLi5jb21waWxlckhvc3QsXG4gICAgZ2V0UHJvamVjdFZlcnNpb246ICgpID0+IHByb2plY3RWZXJzaW9uLnRvU3RyaW5nKCksXG4gICAgZ2V0Q29tcGlsYXRpb25TZXR0aW5nczogKCkgPT4gY29tcGlsZXJPcHRpb25zLFxuICAgIGdldFNjcmlwdEZpbGVOYW1lczogKCkgPT4gZmlsZU5hbWVzLFxuICAgIGdldFNjcmlwdFNuYXBzaG90OiBmaWxlTmFtZSA9PiB7XG4gICAgICBjb25zdCBjb250ZW50cyA9IHN5cy5yZWFkRmlsZShmaWxlTmFtZSlcbiAgICAgIGlmIChjb250ZW50cykge1xuICAgICAgICByZXR1cm4gdHMuU2NyaXB0U25hcHNob3QuZnJvbVN0cmluZyhjb250ZW50cylcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH0sXG4gICAgZ2V0U2NyaXB0VmVyc2lvbjogZmlsZU5hbWUgPT4ge1xuICAgICAgcmV0dXJuIGZpbGVWZXJzaW9ucy5nZXQoZmlsZU5hbWUpIHx8ICcwJ1xuICAgIH0sXG4gICAgd3JpdGVGaWxlOiBzeXMud3JpdGVGaWxlLFxuICB9XG5cbiAgdHlwZSBSZXR1cm4gPSB7XG4gICAgbGFuZ3VhZ2VTZXJ2aWNlSG9zdDogTGFuZ3VhZ2VTZXJ2aWNlSG9zdFxuICAgIHVwZGF0ZUZpbGU6IChzb3VyY2VGaWxlOiBpbXBvcnQoJ3R5cGVzY3JpcHQnKS5Tb3VyY2VGaWxlKSA9PiB2b2lkXG4gIH1cblxuICBjb25zdCBsc0hvc3Q6IFJldHVybiA9IHtcbiAgICBsYW5ndWFnZVNlcnZpY2VIb3N0LFxuICAgIHVwZGF0ZUZpbGU6IHNvdXJjZUZpbGUgPT4ge1xuICAgICAgcHJvamVjdFZlcnNpb24rK1xuICAgICAgZmlsZVZlcnNpb25zLnNldChzb3VyY2VGaWxlLmZpbGVOYW1lLCBwcm9qZWN0VmVyc2lvbi50b1N0cmluZygpKVxuICAgICAgaWYgKCFmaWxlTmFtZXMuaW5jbHVkZXMoc291cmNlRmlsZS5maWxlTmFtZSkpIHtcbiAgICAgICAgZmlsZU5hbWVzLnB1c2goc291cmNlRmlsZS5maWxlTmFtZSlcbiAgICAgIH1cbiAgICAgIHVwZGF0ZUZpbGUoc291cmNlRmlsZSlcbiAgICB9LFxuICB9XG4gIHJldHVybiBsc0hvc3Rcbn1cbiJdfQ==
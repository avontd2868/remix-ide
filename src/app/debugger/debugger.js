'use strict'
var Ethdebugger = require('remix-debug').EthDebugger
var remixLib = require('remix-lib')
var EventManager = remixLib.EventManager
var executionContext = require('../../execution-context')
var globalRegistry = require('../../global/registry')

/**
 * Manage remix and source highlighting
 */
function Debugger (sourceHighlighter) {
  var self = this
  this.event = new EventManager()

  this._components = {
    sourceHighlighter: sourceHighlighter
  }
  this._components.registry = globalRegistry
  // dependencies
  this._deps = {
    offsetToLineColumnConverter: this._components.registry.get('offsettolinecolumnconverter').api,
    editor: this._components.registry.get('editor').api,
    compiler: this._components.registry.get('compiler').api
  }
  this.debugger = new Ethdebugger(
    {
      executionContext: executionContext,
      compilationResult: () => {
        var compilationResult = this._deps.compiler.lastCompilationResult
        if (compilationResult) {
          return compilationResult.data
        }
        return null
      }
    })
  this.sourceMappingDecoder = new remixLib.SourceMappingDecoder()

  this.breakPointManager = new remixLib.code.BreakpointManager(this.debugger, (sourceLocation) => {
    return self._deps.offsetToLineColumnConverter.offsetToLineColumn(sourceLocation, sourceLocation.file, this._deps.compiler.lastCompilationResult.source.sources)
  }, (step) => {
    self.event.trigger('breakpointStep', [step])
  })

  this.debugger.setBreakpointManager(this.breakPointManager)

  self._deps.editor.event.register('breakpointCleared', (fileName, row) => {
    this.breakPointManager.remove({fileName: fileName, row: row})
  })

  self._deps.editor.event.register('breakpointAdded', (fileName, row) => {
    this.breakPointManager.add({fileName: fileName, row: row})
  })

  executionContext.event.register('contextChanged', this, function (context) {
    self.switchProvider(context)
  })

  // unload if a file has changed (but not if tabs were switched)
  self._deps.editor.event.register('contentChanged', function () {
    self.debugger.unLoad()
  })

  // ====================
  // listen to events
  this.debugger.event.register('newTraceLoaded', this, function () {
    self.event.trigger('debuggerStatus', [true])
  })

  this.debugger.event.register('traceUnloaded', this, function () {
    self._components.sourceHighlighter.currentSourceLocation(null)
    self.event.trigger('debuggerStatus', [false])
  })

  // ====================
  // add providers
  this.debugger.addProvider('vm', executionContext.vm())
  this.debugger.addProvider('injected', executionContext.internalWeb3())
  this.debugger.addProvider('web3', executionContext.internalWeb3())
  this.debugger.switchProvider(executionContext.getProvider())
}

Debugger.prototype.registerAndHighlightCodeItem = function (index) {
  const self = this
  // register selected code item, highlight the corresponding source location
  if (self._deps.compiler.lastCompilationResult) {
    self.debugger.traceManager.getCurrentCalledAddressAt(index, (error, address) => {
      if (error) return console.log(error)
      self.debugger.callTree.sourceLocationTracker.getSourceLocationFromVMTraceIndex(address, index, self._deps.compiler.lastCompilationResult.data.contracts, function (error, rawLocation) {
        if (!error && self._deps.compiler.lastCompilationResult && self._deps.compiler.lastCompilationResult.data) {
          var lineColumnPos = self._deps.offsetToLineColumnConverter.offsetToLineColumn(rawLocation, rawLocation.file, self._deps.compiler.lastCompilationResult.source.sources)
          self._components.sourceHighlighter.currentSourceLocation(lineColumnPos, rawLocation)
        } else {
          self._components.sourceHighlighter.currentSourceLocation(null)
        }
      })
    })
  }
}

module.exports = Debugger

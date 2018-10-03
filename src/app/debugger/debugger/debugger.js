'use strict'
var Ethdebugger = require('remix-debug').EthDebugger
var remixLib = require('remix-lib')
var EventManager = remixLib.EventManager

var StepManager = require('./stepManager')

function Debugger (options) {
  var self = this
  this.event = new EventManager()

  this.executionContext = options.executionContext
  this.offsetToLineColumnConverter = options.offsetToLineColumnConverter
  this.compiler = options.compiler

  this.debugger = new Ethdebugger(
    {
      executionContext: this.executionContext,
      compilationResult: () => {
        var compilationResult = this.compiler.lastCompilationResult
        if (compilationResult) {
          return compilationResult.data
        }
        return null
      }
    })

  this.breakPointManager = new remixLib.code.BreakpointManager(this.debugger, (sourceLocation) => {
    return self.offsetToLineColumnConverter.offsetToLineColumn(sourceLocation, sourceLocation.file, this.compiler.lastCompilationResult.source.sources)
  }, (step) => {
    self.event.trigger('breakpointStep', [step])
  })

  this.debugger.setBreakpointManager(this.breakPointManager)

  this.executionContext.event.register('contextChanged', this, function (context) {
    // TODO: was already broken
    // self.switchProvider(context)
  })

  this.debugger.event.register('newTraceLoaded', this, function () {
    self.event.trigger('debuggerStatus', [true])
  })

  this.debugger.event.register('traceUnloaded', this, function () {
    self.event.trigger('debuggerStatus', [false])
  })

  this.debugger.addProvider('vm', this.executionContext.vm())
  this.debugger.addProvider('injected', this.executionContext.internalWeb3())
  this.debugger.addProvider('web3', this.executionContext.internalWeb3())
  this.debugger.switchProvider(this.executionContext.getProvider())
}

Debugger.prototype.registerAndHighlightCodeItem = function (index) {
  const self = this
  // register selected code item, highlight the corresponding source location
  if (!self.compiler.lastCompilationResult) return
  self.debugger.traceManager.getCurrentCalledAddressAt(index, (error, address) => {
    if (error) return console.log(error)
    self.debugger.callTree.sourceLocationTracker.getSourceLocationFromVMTraceIndex(address, index, self.compiler.lastCompilationResult.data.contracts, function (error, rawLocation) {
      if (!error && self.compiler.lastCompilationResult && self.compiler.lastCompilationResult.data) {
        var lineColumnPos = self.offsetToLineColumnConverter.offsetToLineColumn(rawLocation, rawLocation.file, self.compiler.lastCompilationResult.source.sources)
        self.event.trigger('newSourceLocation', [lineColumnPos, rawLocation])
      } else {
        self.event.trigger('newSourceLocation', [null])
      }
    })
  })
}

Debugger.prototype.debug = function (parent) {
  const self = this
  this.step_manager = new StepManager(this.debugger, this.debugger.traceManager)
  parent.event.register('indexChanged', this, (index) => {
    self.step_manager.event.trigger('indexChanged', [index])
  })

  this.debugger.codeManager.event.register('changed', this, (code, address, instIndex) => {
    self.debugger.callTree.sourceLocationTracker.getSourceLocationFromVMTraceIndex(address, this.step_manager.currentStepIndex, this.debugger.solidityProxy.contracts, (error, sourceLocation) => {
      if (!error) {
        parent.event.trigger('sourceLocationChanged', [sourceLocation])
      }
    })
  })
}

module.exports = Debugger

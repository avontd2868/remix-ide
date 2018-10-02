'use strict'
// var TxBrowser = require('./TxBrowser')
// var StepManager = require('./StepManager')
// var VmDebugger = require('./VmDebugger')

var yo = require('yo-yo')
var csjs = require('csjs-inject')

var remixLib = require('remix-lib')
var executionContext = remixLib.execution.executionContext
var EventManager = remixLib.EventManager

var css = csjs`
  .statusMessage {
    margin-left: 15px;
  }
  .innerShift {
    padding: 2px;
    margin-left: 10px;
  }
`

function EthdebuggerUI (opts) {
  this.opts = opts || {}
  this.debugger = opts.debugger

  var self = this
  this.event = new EventManager()

  this.currentStepIndex = -1
  this.tx
  this.statusMessage = ''

  this.view

  this.event.register('indexChanged', this, function (index) {
    self.debugger.codeManager.resolveStep(index, self.tx)
  })

  executionContext.event.register('contextChanged', this, function () {
    self.updateWeb3Reference()
  })
}

EthdebuggerUI.prototype.updateWeb3Reference = function (web3) {
  if (!this.txBrowser) return
  this.txBrowser.web3 = web3 || executionContext.web3()
}

EthdebuggerUI.prototype.render = function () {
  this.debuggerPanelsView = yo`<div class="${css.innerShift}"></div>`
  this.debuggerHeadPanelsView = yo`<div class="${css.innerShift}"></div>`
  this.stepManagerView = yo`<div class="${css.innerShift}"></div>`

  var view = yo`<div>
        <div class="${css.innerShift}">
          ${this.txBrowser.render()}
          ${this.debuggerHeadPanelsView}
          ${this.stepManagerView}
        </div>
        <div class="${css.statusMessage}" >${this.statusMessage}</div>
        ${this.debuggerPanelsView}
     </div>`
  if (!this.view) {
    this.view = view
  }
  return view
}

EthdebuggerUI.prototype.unLoad = function () {
  this.debugger.unLoad()
  yo.update(this.debuggerHeadPanelsView, yo`<div></div>`)
  yo.update(this.debuggerPanelsView, yo`<div></div>`)
  yo.update(this.stepManagerView, yo`<div></div>`)
  if (this.vmDebugger) this.vmDebugger.remove()
  if (this.stepManager) this.stepManager.remove()
  this.vmDebugger = null
  this.stepManager = null
  this.event.trigger('traceUnloaded')
}

EthdebuggerUI.prototype.stepChanged = function (stepIndex) {
  this.currentStepIndex = stepIndex
  this.event.trigger('indexChanged', [stepIndex])
}

EthdebuggerUI.prototype.startDebugging = function (blockNumber, txIndex, tx) {
  const self = this
  if (this.debugger.traceManager.isLoading) {
    return false
  }

  this.tx = tx

  this.debugger.codeManager.event.register('changed', this, (code, address, instIndex) => {
    self.debugger.callTree.sourceLocationTracker.getSourceLocationFromVMTraceIndex(address, this.currentStepIndex, this.debugger.solidityProxy.contracts, (error, sourceLocation) => {
      if (!error) {
        self.event.trigger('sourceLocationChanged', [sourceLocation])
      }
    })
  })

  return true
}

EthdebuggerUI.prototype.andAddVmDebugger = function () {
  yo.update(this.debuggerHeadPanelsView, this.vmDebugger.renderHead())
  yo.update(this.debuggerPanelsView, this.vmDebugger.render())
  yo.update(this.stepManagerView, this.stepManager.render())
}

module.exports = EthdebuggerUI

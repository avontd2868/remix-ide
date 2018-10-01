'use strict'
var csjs = require('csjs-inject')
var CodeListView = require('./vmDebugger/CodeListView')
var CalldataPanel = require('./vmDebugger/CalldataPanel')
var MemoryPanel = require('./vmDebugger/MemoryPanel')
var CallstackPanel = require('./vmDebugger/CallstackPanel')
var StackPanel = require('./vmDebugger/StackPanel')
var StoragePanel = require('./vmDebugger/StoragePanel')
var StepDetail = require('./vmDebugger/StepDetail')

var DebuggerSolidityState = require('../solidityState')
var DebuggerSolidityLocals = require('../solidityLocals')
var SolidityState = require('./vmDebugger/SolidityState')
var SolidityLocals = require('./vmDebugger/SolidityLocals')

var FullStoragesChangesPanel = require('./vmDebugger/FullStoragesChanges')
var DropdownPanel = require('./vmDebugger/DropdownPanel')
var remixDebug = require('remix-debug')
var remixLib = require('remix-lib')
var EventManager = remixLib.EventManager
var ui = remixLib.helpers.ui
var StorageResolver = remixDebug.storage.StorageResolver
var StorageViewer = remixDebug.storage.StorageViewer
var yo = require('yo-yo')

var css = csjs`
  .asmCode {
    float: left;
    width: 50%;
  }
  .stepDetail {
  }
  .vmheadView {
    margin-top:10px;
  }
`

class VmDebuggerLogic {

  constructor (_parentUI, _traceManager, _codeManager, _solidityProxy, _callTree) {
    this.event = new EventManager()
    this._parentUI = _parentUI
    this._parent = this._parentUI.debugger
    this._traceManager = _traceManager
    this._codeManager = _codeManager
    this._solidityProxy = _solidityProxy
    this._callTree = _callTree
    this.storageResolver = null
  }

  start () {
    this.listenToEvents()
    this.listenToCodeManagerEvents()
    this.listenToTraceManagerEvents()
    this.listenToFullStorageChanges()
    this.listenToNewChanges()
  }

  listenToEvents () {
    const self = this
    this._parent.event.register('traceUnloaded', function () {
      self.event.trigger('traceUnloaded')
    })
  }

  listenToCodeManagerEvents () {
    const self = this
    this._codeManager.event.register('changed', function (code, address, index) {
      self.event.trigger('codeManagerChanged', [code, address, index])
    })
  }

  listenToTraceManagerEvents () {
    const self = this

    this._parentUI.event.register('indexChanged', this, function (index) {
      if (index < 0) return
      if (self._parentUI.currentStepIndex !== index) return

      self.event.trigger('indexUpdate', [index])

      self._traceManager.getCallDataAt(index, function (error, calldata) {
        if (error) {
          console.log(error)
          self.event.trigger('traceManagerCallDataUpdate', [{}])
        } else if (self._parentUI.currentStepIndex === index) {
          self.event.trigger('traceManagerCallDataUpdate', [calldata])
        }
      })

      self._traceManager.getMemoryAt(index, function (error, memory) {
        if (error) {
          console.log(error)
          self.event.trigger('traceManagerMemoryUpdate', [{}])
        } else if (self._parentUI.currentStepIndex === index) {
          self.event.trigger('traceManagerMemoryUpdate', [ui.formatMemory(memory, 16)])
        }
      })

      self._traceManager.getCallStackAt(index, function (error, callstack) {
        if (error) {
          console.log(error)
          self.event.trigger('traceManagerCallStackUpdate', [{}])
        } else if (self._parentUI.currentStepIndex === index) {
          self.event.trigger('traceManagerCallStackUpdate', [callstack])
        }
      })

      self._traceManager.getStackAt(index, function (error, callstack) {
        if (error) {
          console.log(error)
          self.event.trigger('traceManagerStackUpdate', [{}])
        } else if (self._parentUI.currentStepIndex === index) {
          self.event.trigger('traceManagerStackUpdate', [callstack])
        }
      })

      self._traceManager.getCurrentCalledAddressAt(index, (error, address) => {
        if (error) return
        if (!self.storageResolver) return

        var storageViewer = new StorageViewer({ stepIndex: self._parentUI.currentStepIndex, tx: self._parentUI.tx, address: address }, self.storageResolver, self._traceManager)

        storageViewer.storageRange((error, storage) => {
          if (error) {
            console.log(error)
            self.event.trigger('traceManagerStorageUpdate', [{}])
          } else if (self._parentUI.currentStepIndex === index) {
            var header = storageViewer.isComplete(address) ? 'completely loaded' : 'partially loaded...'
            self.event.trigger('traceManagerStorageUpdate', [storage, header])
          }
        })
      })

      self._traceManager.getCurrentStep(index, function (error, step) {
        self.event.trigger('traceCurrentStepUpdate', [error, step])
      })

      self._traceManager.getMemExpand(index, function (error, addmem) {
        self.event.trigger('traceMemExpandUpdate', [error, addmem])
      })

      self._traceManager.getStepCost(index, function (error, gas) {
        self.event.trigger('traceStepCostUpdate', [error, gas])
      })

      self._traceManager.getCurrentCalledAddressAt(index, function (error, address) {
        self.event.trigger('traceCurrentCalledAddressAtUpdate', [error, address])
      })

      self._traceManager.getRemainingGas(index, function (error, remaining) {
        self.event.trigger('traceRemainingGasUpdate', [error, remaining])
      })

      self._traceManager.getReturnValue(index, function (error, returnValue) {
        if (error) {
          self.event.trigger('traceReturnValueUpdate', [[error]])
        } else if (self._parentUI.currentStepIndex === index) {
          self.event.trigger('traceReturnValueUpdate', [[returnValue]])
        }
      })
    })
  }

  listenToFullStorageChanges () {
    const self = this

    this.address = []
    this.traceLength = 0

    self._parentUI.debugger.event.register('newTraceLoaded', function (length) {
      self._traceManager.getAddresses(function (error, addresses) {
        if (error) return
        self.event.trigger('traceAddressesUpdate', [addresses])
        self.addresses = addresses
      })

      self._traceManager.getLength(function (error, length) {
        if (error) return
        self.event.trigger('traceLengthUpdate', [length])
        self.traceLength = length
      })
    })

    self._parentUI.debugger.event.register('indexChanged', this, function (index) {
      if (index < 0) return
      if (self._parent.currentStepIndex !== index) return
      if (!self.storageResolver) return

      if (index !== self.traceLength - 1) {
        return self.event.trigger('traceLengthUpdate', [{}])
      }
      var storageJSON = {}
      for (var k in self.addresses) {
        var address = self.addresses[k]
        var storageViewer = new StorageViewer({ stepIndex: self._parent.currentStepIndex, tx: self._parent.tx, address: address }, self.storageResolver, self._traceManager)
        storageViewer.storageRange(function (error, result) {
          if (!error) {
            storageJSON[address] = result
            self.event.trigger('traceLengthUpdate', [storageJSON])
          }
        })
      }
    })
  }

  listenToNewChanges () {
    const self = this
    self._parent.event.register('newTraceLoaded', this, function () {
      self.storageResolver = new StorageResolver({web3: self._parent.web3})
      self.event.trigger('newTrace', [])
    })

    self._parent.event.register('callTreeReady', function () {
      if (self._parent.callTree.reducedTrace.length) {
        return self.event.trigger('newCallTree', [])
      }
    })
  }

}

function VmDebugger (_parentUI, _traceManager, _codeManager, _solidityProxy, _callTree) {
  // let _parent = _parentUI.debugger
  var self = this
  this.view

  this.vmDebuggerLogic = new VmDebuggerLogic(_parentUI, _traceManager, _codeManager, _solidityProxy, _callTree)

  this.asmCode = new CodeListView()
  this.vmDebuggerLogic.event.register('codeManagerChanged', this.asmCode.changed.bind(this.asmCode))
  this.vmDebuggerLogic.event.register('traceUnloaded', this.asmCode.reset.bind(this.asmCode))

  this.calldataPanel = new CalldataPanel()
  this.vmDebuggerLogic.event.register('traceManagerCallDataUpdate', this.calldataPanel.update.bind(this.calldataPanel))

  this.memoryPanel = new MemoryPanel()
  this.vmDebuggerLogic.event.register('traceManagerMemoryUpdate', this.memoryPanel.update.bind(this.memoryPanel))

  this.callstackPanel = new CallstackPanel()
  this.vmDebuggerLogic.event.register('traceManagerCallStackUpdate', this.callstackPanel.update.bind(this.callstackPanel))

  this.stackPanel = new StackPanel()
  this.vmDebuggerLogic.event.register('traceManagerStackUpdate', this.stackPanel.update.bind(this.stackPanel))

  this.storagePanel = new StoragePanel()
  this.vmDebuggerLogic.event.register('traceManagerStorageUpdate', this.storagePanel.update.bind(this.storagePanel))

  this.stepDetail = new StepDetail()
  _parentUI.debugger.event.register('traceUnloaded', this.stepDetail.reset.bind(this.stepDetail))
  _parentUI.debugger.event.register('newTraceLoaded', this.stepDetail.reset.bind(this.stepDetail))

  this.vmDebuggerLogic.event.register('traceCurrentStepUpdate', function (error, step) {
    self.stepDetail.updateField('execution step', (error ? '-' : step))
  })

  this.vmDebuggerLogic.event.register('traceMemExpandUpdate', function (error, addmem) {
    self.stepDetail.updateField('add memory', (error ? '-' : addmem))
  })

  this.vmDebuggerLogic.event.register('traceStepCostUpdate', function (error, gas) {
    self.stepDetail.updateField('gas', (error ? '-' : gas))
  })

  this.vmDebuggerLogic.event.register('traceCurrentCalledAddressAtUpdate', function (error, address) {
    self.stepDetail.updateField('loaded address', (error ? '-' : address))
  })

  this.vmDebuggerLogic.event.register('traceRemainingGasUpdate', function (error, remainingGas) {
    self.stepDetail.updateField('remaining gas', (error ? '-' : remainingGas))
  })

  this.vmDebuggerLogic.event.register('indexUpdate', function (index) {
    self.stepDetail.updateField('vm trace step', index)
  })

  this.debuggerSolidityState = new DebuggerSolidityState(_parentUI, _traceManager, _codeManager, _solidityProxy)
  this.solidityState = new SolidityState()
  this.debuggerSolidityState.init()
  this.debuggerSolidityState.event.register('solidityState', this, function (state) {
    self.solidityState.update(state)
  })
  this.debuggerSolidityState.event.register('solidityStateMessage', this, function (message) {
    self.solidityState.setMessage(message)
  })
  this.debuggerSolidityState.event.register('solidityStateUpdating', this, function () {
    self.solidityState.setUpdating()
  })

  this.debuggerSolidityLocals = new DebuggerSolidityLocals(_parentUI, _traceManager, _callTree)
  this.solidityLocals = new SolidityLocals()
  this.debuggerSolidityLocals.event.register('solidityLocals', this, function (state) {
    self.solidityLocals.update(state)
  })
  this.debuggerSolidityLocals.event.register('solidityLocalsMessage', this, function (message) {
    self.solidityLocals.setMessage(message)
  })
  this.debuggerSolidityLocals.event.register('solidityLocalsUpdating', this, function () {
    self.solidityLocals.setUpdating()
  })
  this.debuggerSolidityLocals.init()

  this.returnValuesPanel = new DropdownPanel('Return Value', {json: true})
  this.returnValuesPanel.data = {}
  this.debuggerSolidityLocals.event.register('traceReturnValueUpdate', this.returnValuesPanel.update.bind(this.returnValuesPanel))

  this.fullStoragesChangesPanel = new FullStoragesChangesPanel(_parentUI, _traceManager)
  this.addresses = []

  this.vmDebuggerLogic.event.register('traceAddressesUpdate', function (_addresses) {
    self.fullStoragesChangesPanel.update({})
  })

  this.vmDebuggerLogic.event.register('traceStorageUpdate', function (data) {
    self.fullStoragesChangesPanel.update(data)
  })

  this.vmDebuggerLogic.event.register('newTrace', () => {
    if (!self.view) return

    self.debuggerSolidityState.storageResolver = self.vmDebuggerLogic.storageResolver
    self.debuggerSolidityLocals.storageResolver = self.vmDebuggerLogic.storageResolver
    // self.solidityState.storageResolver = self.storageResolver
    // self.fullStoragesChangesPanel.storageResolver = self.storageResolver

    self.asmCode.basicPanel.show()
    self.stackPanel.basicPanel.show()
    self.storagePanel.basicPanel.show()
    self.memoryPanel.basicPanel.show()
    self.calldataPanel.basicPanel.show()
    self.callstackPanel.basicPanel.show()
  })

  this.vmDebuggerLogic.event.register('newCallTree', () => {
    if (!self.view) return
    self.solidityLocals.basicPanel.show()
    self.solidityState.basicPanel.show()
  })

  this.vmDebuggerLogic.start()
}

VmDebugger.prototype.renderHead = function () {
  var headView = yo`<div id='vmheadView' class=${css.vmheadView}>
        <div>
          <div class=${css.asmCode}>${this.asmCode.render()}</div>
          <div class=${css.stepDetail}>${this.stepDetail.render()}</div>
        </div>
      </div>`
  if (!this.headView) {
    this.headView = headView
  }
  return headView
}

VmDebugger.prototype.remove = function () {
  // used to stop listenning on event. bad and should be "refactored"
  this.view = null
}

VmDebugger.prototype.render = function () {
  var view = yo`<div id='vmdebugger'>
        <div>
            ${this.solidityLocals.render()}
            ${this.solidityState.render()}
            ${this.stackPanel.render()}
            ${this.memoryPanel.render()}
            ${this.storagePanel.render()}
            ${this.callstackPanel.render()}
            ${this.calldataPanel.render()}
            ${this.returnValuesPanel.render()}
            ${this.fullStoragesChangesPanel.render()}
          </div>
      </div>`
  if (!this.view) {
    this.view = view
  }
  return view
}

module.exports = VmDebugger

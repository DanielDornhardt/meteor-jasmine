/* global
   VelocityTestReporter: true
 */

var noopTimer = {
  start: function() {},
  elapsed: function() { return 0 }
}

VelocityTestReporter = function VelocityTestReporter(options) {
  var self = this,
      timer = options.timer || noopTimer,
      ancestors = [],
      _jasmineDone

  self.mode = options.mode

  var saveTestResult = Meteor.bindEnvironment(function saveTestResult(test) {
    var result = {
      id: 'jasmine:' + self.mode + ' | ' + test.id,
      //async: test.async,
      framework: options.framework,
      name: test.fullName,
      pending: test.status === 'pending',
      result: test.status,
      time: timer.elapsed(),
      //timeOut: test._timeout,
      //timedOut: test.timedOut,
      ancestors: ancestors,
      timestamp: new Date().toTimeString()
    }
    if (test.failedExpectations[0]){
      result.failureMessage = test.failedExpectations[0].message
      result.failureStackTrace = test.failedExpectations[0].stack
    }

    if (Meteor.isClient) {
      result.isClient = true
      window.ddpParentConnection.call('postResult', result, function(error){
        if (error){
          console.error('ERROR WRITING TEST', error)
        }
      })
    } else if (Meteor.isServer) {
      result.isServer = true
      Meteor.call('postResult', result, function(error){
        if (error){
          console.error('ERROR WRITING TEST', error)
        }
      })
    }
  }, function (error) {
    console.error(error)
  })

  if (Meteor.isClient) {
    _jasmineDone = function () {
      window.ddpParentConnection.call('completed', {framework: options.framework})
      options.onComplete && options.onComplete()
    }
  } else if (Meteor.isServer) {
    _jasmineDone = Meteor.bindEnvironment(function jasmineDone() {
      //Meteor.call('jasmineMarkServerTestsCompleted')
      options.onComplete && options.onComplete()
    }, function (error) {
      console.error(error)
      options.onComplete && options.onComplete()
    })
  }

  self.jasmineDone = _jasmineDone

  self.suiteStarted = function(result) {
    ancestors.unshift(result.description)
  }

  self.suiteDone = function() {
    ancestors.shift()
  }

  self.specStarted = function () {
    timer.start()
  }

  self.specDone = function(result) {
    saveTestResult(result)
  }
}

/* global
 Velocity: false
 */

if (Meteor.isServer) {

  var consoleClientReporter;

  Meteor.methods({
    "jasmineStartedConsumer": function () {
      consoleClientReporter = getJasmineConsoleReporter("integration", true)
      consoleClientReporter.jasmineStarted();
      return consoleClientReporter.id;
    },
    "jasmineDoneConsumer": function (id) {
      check(id, Match.OneOf(null, Match.Integer))
      // id prevents multiple postings to to the same console from various runs
      consoleClientReporter.jasmineDone()
    },
    "specDoneConsumer": function (result, id) {
      check(result, Object)
      check(id, Match.OneOf(null, Match.Integer))
      consoleClientReporter.specDone(result)
    }
  })
}

ClientIntegrationTestFramework = function (options) {
  options = options || {}

  _.defaults(options, {
    name: 'jasmine-client-integration',
    regex: 'jasmine/client/integration/.+\\.(js|coffee|litcoffee|coffee\\.md)$',
    jasmineRequire: Meteor.isClient ? window.jasmineRequire : null
  })

  JasmineTestFramework.call(this, options)

  if (Meteor.isClient) {
    this._setup()
  }
}

ClientIntegrationTestFramework.prototype = Object.create(JasmineTestFramework.prototype)

_.extend(ClientIntegrationTestFramework.prototype, {

  _setup: function () {
    this.jasmine = this.jasmineRequire.core(this.jasmineRequire)
    this.jasmineInterface = new JasmineInterface({jasmine: this.jasmine})
    _.extend(window, this.jasmineInterface)
  },

  startFileCopier: function () {
    var fileCopier = new Velocity.FileCopier({
      targetFramework: this.name,
      shouldCopy: function (filepath) {
        var isClient = filepath.absolutePath.indexOf('server') === -1

        return isClient
      },
      convertTestPathToMirrorPath: function (filePath) {
        return filePath.replace('jasmine/client', 'client/jasmine');
      }
    })
    fileCopier.start()
  },

  runTests: function () {
    var self = this

    /**
     * Since this is being run in a browser and the results should populate to an HTML page, require the HTML-specific Jasmine code, injecting the same reference.
     */
    this.jasmineRequire.html(this.jasmine)

    /**
     * Create the Jasmine environment. This is used to run all specs in a project.
     */
    var env = this.jasmine.getEnv()

    /**
     * ## Runner Parameters
     *
     * More browser specific code - wrap the query string in an object and to allow for getting/setting parameters from the runner user interface.
     */

    var queryString = new this.jasmine.QueryString({
      getWindowLocation: function() { return window.location }
    })

    var catchingExceptions = queryString.getParam('catch')
    env.catchExceptions(typeof catchingExceptions === 'undefined' ? true : catchingExceptions)

    /**
     * ## Reporters
     */
    var velocityReporter = new VelocityTestReporter({
      mode: "Client Integration",
      framework: this.name,
      env: env,
      timer: new this.jasmine.Timer()
    })

    var currentId;

    var serverReporter = {
      jasmineStarted: function() {
        window.ddpParentConnection.call("jasmineStartedConsumer", function(err, result) {
          currentId = result;
        });
      },
      jasmineDone: function () {
        window.ddpParentConnection.call("jasmineDoneConsumer", currentId)
      },
      specDone: function (result) {
        window.ddpParentConnection.call("specDoneConsumer", result, currentId)
      }
    }

    env.addReporter(serverReporter);

    /**
     * The `jsApiReporter` also receives spec results, and is used by any environment that needs to extract the results  from JavaScript.
     */
    env.addReporter(this.jasmineInterface.jsApiReporter)
    env.addReporter(velocityReporter)

    /**
     * Filter which specs will be run by matching the start of the full name against the `spec` query param.
     */
    var specFilter = new this.jasmine.HtmlSpecFilter({
      filterString: function() { return queryString.getParam('spec') }
    })

    env.specFilter = function(spec) {
      return specFilter.matches(spec.getFullName())
    }

    /**
     * Setting up timing functions to be able to be overridden. Certain browsers (Safari, IE 8, phantomjs) require this hack.
     */
    window.setTimeout = window.setTimeout
    window.setInterval = window.setInterval
    window.clearTimeout = window.clearTimeout
    window.clearInterval = window.clearInterval

    /**
     * ## Execution
     */
    window.ddpParentConnection = null
    window.jasmineWebClientTestsComplete = false

    Meteor.startup(function(){
      Meteor.call('jasmine/isMirror', function(error, mirrorInfo) {
        if (error) {
          throw error
        } else if (mirrorInfo.isMirror) {
          Meteor.setTimeout(function(){
            window.ddpParentConnection = DDP.connect(mirrorInfo.parentUrl)
            if (/jasmine=true/.test(document.location.href.split("?")[1]))
              logInfo('Running Jasmine tests');
              env.execute()
          }, 0)
        } else {
          Tracker.autorun(function (computation) {
            var clientIntegrationTestsExist = VelocityTestFiles.find(
                {targetFramework: self.name}).count() > 0

            if (clientIntegrationTestsExist) {
              computation.stop()

              var insertMirrorIframe = _.once(function (mirrorInfo) {
                var iframe = document.createElement('iframe')
                iframe.src = mirrorInfo.rootUrl + "?jasmine=true"
                // Make the iFrame invisible
                iframe.style.width = 0
                iframe.style.height = 0
                iframe.style.border = 0
                document.body.appendChild(iframe)
              })

              Meteor.call(
                'velocity/mirrors/request',
                {framework: 'jasmine'},
                function (error, requestId) {
                  if (error) {
                    logError(error)
                  } else {
                    var mirrorQuery = VelocityMirrors.find({requestId: requestId})
                    if (mirrorQuery.count() > 0) {
                      var mirrorInfo = mirrorQuery.fetch()[0];
                      insertMirrorIframe(mirrorInfo);
                    } else {
                      mirrorQuery.observe({
                        added: insertMirrorIframe,
                        changed: insertMirrorIframe
                      })
                    }
                  }
                }
              )
            }
          })
        }
      })
    })
  },

  _reportResults: function () {
    Meteor.call('velocity/reports/completed', {framework: this.name})
  }
})

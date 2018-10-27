if (window.location.href.indexOf('localhost') > -1) {
  var ENV = 'local';
} else {
  var ENV = 'github';
}

var GITHUB_ROOT = 'https://raw.githubusercontent.com/jeremydw/grow2-prototype/master'; 
var REFRESH_CACHE = new URL(window.location.href).searchParams.has('refresh');


/**
 * Helper to deep walk objects.
 */

async function iterate(obj, cb) {
  for (var property in obj) {
    await cb(obj);
    if (obj.hasOwnProperty(property)) {
      var val = obj[property];
      if (typeof val == 'object') {
	await iterate(val, cb);
      }
    }
  }
}


/**
 * Cache to avoid round-trips to the server for files.
 */


function Cache() {
  this.fields = {};
};


Cache.prototype.set = function (key, val) {
  this.fields[key] = val;
};


Cache.prototype.has = function (key) {
  return this.fields.hasOwnProperty(key);
};


Cache.prototype.get = function (key) {
  return this.fields[key];
};


const _DOC_CACHE= new Cache();
const _HTTP_CACHE = new Cache();


/**
 * Custom YAML types.
 */


var DocYamlType = new jsyaml.Type('!g.doc', {
  kind: 'scalar',
  construct: function(path) {
    return Doc.get(path);
  },
  instanceOf: Doc
});


var StaticYamlType = new jsyaml.Type('!g.static', {
  kind: 'scalar',
  construct: function(path) {
    return Static.get(path);
  },
  instanceOf: Static
});


var schema = jsyaml.Schema.create([
  DocYamlType, 
  StaticYamlType
]);


/**
 * Static object.
 */


function Static(path) {
  this.path = path;
  this.url = path;
}


Static.get = function(path) {
  return new Static(path);
}


/**
 * URL object.
 */


function Url(path) {
  this.path = path;
};


Url.prototype.toString = function() {
  return this.path;
};


/**
 * Routes object.
 */


function Routes(path) {
  this.path = path;
  this.trie = new Trie();
  this.doc_ = Doc.get(path);
}


Routes.prototype.match = function(path) {
  // Return the doc to render.
  let match = this.trie.match(path);
  if (!match.node) {
    throw Error('No pattern in /routes.yaml matches -> ' + path);
    return;
  }
  let data = match.node.data;

  if (data.doc) {
    return data.doc;
  } else if (data.collection) {
    // NOTE: So hacky. We should have methods to convert routes nicely.
    var collection = data.collection.replace('_blueprint.yaml', '');
    return Doc.get(collection + match.params['base'] + '.yaml');
  }
};


Routes.prototype.buildUrl = function(doc) {
  var url = null;
  this.doc_.fields['routes'].forEach(function(route) {
    // NOTE: Replace this with some sort of "isInRoute" to see if a route
    // definition matches a given document.
    if (route.doc == doc || route.collection == doc.collection_path) {
      var pattern = route.pattern;
      pattern = pattern.replace(':base', doc.base);
      url = new Url(pattern);
    }
  });
  return url;
}


Routes.prototype.resolve = async function() {
  await this.doc_.resolve();
  this.doc_.fields['routes'].forEach(function(route) {
    // NOTE: I hacked trie.js to allow for this second argument to put
    // arbitrary data on the matched nodes.
    this.trie.define(route.pattern, route);
  }.bind(this));
}


/**
 * Pod object.
 */


function Pod() {
  this.routes = new Routes('/routes.yaml');
}


/**
 * Document object.
 */


function Doc(path) {
  this.path = path;
  this.base = path.split('/', -1).pop().split('.')[0];
  this.collection_path = path.replace(this.base + '.yaml', '_blueprint.yaml');

  this.fields = null;
  this.resolved = false;
}


Doc.prototype.url = function() {
  // pod is a global, but that's bad. Use a factory/builder paradigm to inject
  // the pod instance into the doc instead. Also, figure out a way to make the
  // URL lazy so we don't have to do this on object instantiation. Maybe make
  // it a function call instead? i.e. doc.url().
  return pod.routes.buildUrl(this);
};


Doc.get = function(path) {
  // Docs are a bit expensive with all the YAML fetching and parsing. Use a
  // global doc cache because once docs are resolved they don't change.
  if (_DOC_CACHE.has(path)) {
    return _DOC_CACHE.get(path);
  }
  let doc = new Doc(path);
  _DOC_CACHE.set(path, doc);
  return doc;
}


Doc.prototype.populate = function() {
  for (var property in this.fields) {
    // TODO: Handle builtins somehow.
    let cleanProperty = property.replace('$', '');
    if (this.hasOwnProperty(cleanProperty)) {
      continue;
    }
    this[cleanProperty] = this.fields[property];
  }
};


Doc.prototype.toString = function() {
  // Star to indicate unresolved fields, useful for debugging.
  if (this.resolved) {
    return '<Doc [path=' + this.path + ']>';
  } else {
    return '<Doc* [path=' + this.path + ']>';
  }
};


Doc.prototype.resolve = async function () {
  if (this.resolved) {
    return;
  }
  console.log('Resolving', this.path);
  await this._resolve();
  async function cb(obj) {
    if (obj.resolve) {
      await obj.resolve();
    }
  }
  await iterate(this.fields, cb);
};


Doc.prototype._resolve = async function() {
  var resp = await idbKeyval.get(this.path);
  if (typeof resp == 'undefined' || REFRESH_CACHE) {
    // NOTE: We want to abstract this out so we can use fs in the Node env.
    let path = this.path;
    if (ENV == 'github') {
      // Bust cache to force github refreshes.
      path = GITHUB_ROOT + this.path + '?cb=' + performance.now();
    }
    var resp = await jQuery.get(path);
    idbKeyval.set(this.path, resp);
  }
  let fields = await jsyaml.load(resp, {schema: schema});
  this.fields = fields;
  this.populate();
  this.resolved = true;
};


Doc.prototype.getView = function() {
  let view = this.fields['$view'] || '/views/base.html';
  return view.replace('/views', 'views');
};


function gettext(content) {
  return content;
}


/**
 * Set up the nunchucks env.
 */


var IndexedDbLoader = nunjucks.Loader.extend({
  async: true,
  init: function(root, opts) {
    this.webLoader = new nunjucks.WebLoader(root, opts);
  },
  getSource: async function(name, cb) {
    if (!REFRESH_CACHE) {
      var resp = await idbKeyval.get(name);
      if (resp) {
        cb(null, {
          'src': resp,
          'path': name
        });
        return;
      }
    }
    this.webLoader.getSource(name, function(err, result) {
      if (!err) {
        idbKeyval.set(name, result['src']);
      }
      cb(err, result);
    });
  }
});


function setupNunjucks() {
  // ../ is a hack. Get it working correctly. See the junk in server.js.
  var root = '../';
  if (ENV == 'github') {
    root = GITHUB_ROOT;
  }

  let env = new nunjucks.Environment([
    new IndexedDbLoader(root, {async: true})
  ], {
    async: true,
    autoescape: true
  });
  env.addFilter('resolve', async function(resolver, cb) {
    await resolver.resolve();
    cb(null, resolver);
  }, true);
  env.addFilter('localize', function(str) {
    return str;  // No-op.
  });
  env.addFilter('json', function(obj) {
    return JSON.stringify(obj);
  });
  return env;
}


// NOTE: This is global now, which is bad. Done this way so Docs, Routes, etc.
// can pull into the Pod object. What we should do instead is use a
// factory/builder method on the Pod, to always generate Docs, Objects, etc.
// that way, and then inject the Pod instance onto the Docs (like how Grow1
// works).
var pod = new Pod();


async function main() {
  let startTime = performance.now();

  // Make a pod and resolve the routes from /routes.yaml.
  await pod.routes.resolve();
  // Get the doc that corresponds to the URL path.
  let doc = pod.routes.match(window.location.pathname);
  await doc.resolve();

  let endTime = performance.now();
  console.log('Loaded: ' + Math.floor(endTime - startTime) + 'ms');

  // Use these params for all template envs.
  let params = {
    '_': gettext,
    'doc': doc,
    'g': {
      'doc': Doc.get,
      'static': Static.get
    }
  }

  // Render the doc and write the output to the browser document.
  startTime = performance.now();
  let env = setupNunjucks();
  let html = env.render(doc.getView(), params, function(err, res) {
    let endTime = performance.now();
    // Preserve grow console.
    var grow = document.getElementById('grow');
    var el = grow.cloneNode(true);
    document.write(res);
    document.close();
    document.body.appendChild(el);
    console.log('Rendered: ' + Math.floor(endTime - startTime) + 'ms');
  });
};
main();

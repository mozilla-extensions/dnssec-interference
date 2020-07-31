#!/usr/bin/env node
const VERSION = require('./package.json').version;

var Ajv = require('ajv');
var ajv = new Ajv();

var jsonschema = {
  validate: function (data, schema) {
    var valid = ajv.validate(schema, data);
    return {valid: valid, errors:  ajv.errors || []};
  }
};

var schemas = {
  'shield-study': require('./schemas-client/shield-study.schema.json'),
  'shield-study-addon': require('./schemas-client/shield-study-addon.schema.json'),
  'shield-study-error': require('./schemas-client/shield-study-error.schema.json')
};

const assert = require('assert');
const randomstring = require('randomstring');
var jsonfile = require('jsonfile');

var validStudyStates =   schemas['shield-study'].properties.data.properties.study_state.enum;
var validErrorSource =   schemas['shield-study-error'].properties.data.properties.error_source.enum;
var validErrorSeverity = schemas['shield-study-error'].properties.data.properties.severity.enum;

var studyNames = ['fake-study-1', 'something@moz'];
var branches = ['control','totally-gnarly-1', 'medium-råre'];

/* [a, b] or  [1, a] */
function randInt(a, b) {
  if (b === undefined) {
    b=a;
    a=1;
  }
  return Math.floor(Math.random()*(b-a-1) + a);
}

//function codepoint() {
//  return '\\u' + randomstring.generate({length:4, charset: 'hex'});
//}

function genString (length) {
  return randomstring.generate({length: length, charset: 'alphanumeric', readable: false});
}

function randEl (anArray) {
  return anArray[randInt(0, anArray.length + 1)];
}

function generateAttributes () {
  let attributes = {};
  Array(randInt(0,10)).fill(1).forEach((k) => {
    attributes[genString(randInt(1,10))] = genString(randInt(1,10));
  });
  return attributes;
}

function generateValidCommon (which) {
  return {
    version: 3,
    study_name: randEl(studyNames),
    branch: randEl(branches),
    addon_version: '0.1.1',
    shield_version: '1.2.3',
    testing:  true,
    type: which
  };
}

function generateShieldStudy(maximal = true) {
  var data = {
    study_state: randEl(validStudyStates),
  };
  if (maximal) {
    data.study_state_fullname = genString(randInt(1,20));
    data.attributes = generateAttributes();
  }
  return data;
}

function generateShieldAddon(maximal = true) {
  var data = {
    attributes: generateAttributes()
  };
  if (!maximal) {
    data.attributes = {};
  }
  return data;
}

function generateShieldError(maximal=true) {
  var data = {
    error_id:  genString(randInt(1,30)),
    error_source: randEl(validErrorSource),
    // optional
    severity: randEl(validErrorSeverity),
    message:  genString(randInt(1,30)),
    attributes:  {
      a: 'a'
    },
    error: {stack: 'thing'}
  };

  if (!maximal) {
    delete data.severity;
    delete data.message;
    delete data.attributes;
    delete data.error;
  }

  return data;
}

function validate (thing, schema) {
  if (schema === undefined) {
    schema = schemas[thing.type];
  }
  return jsonschema.validate(thing, schema);
}

function jcopy (thing) {
  return JSON.parse(JSON.stringify(thing));
}
function combine (common, dataField) {
  var a = jcopy(common);
  a.data = jcopy(dataField);
  return a;
}


function noErrors(validationResult) {
  //console.log(validationResult.errors.length, validationResult.errors.length == 0 )
  return validationResult.errors.length === 0;
}


function simpleTest(common, data, msg, ok=true) {

  var d = combine(common, data );

  let validation = validate(d);
  let val = noErrors(validate(d));

  if (!ok) {
    val = !val;
  }

  assert.ok(val, `${msg} :: node ${validation.errors}`);
}


var tests = {};
tests.only = {};

tests['test empty doesnt validate'] = function () {
  //console.log(validate({}));
  Object.keys(schemas).map(function (k) {
    assert.equal(noErrors(validate({}, schemas[k])), false);
  });
};

tests['test shield-study MINIMAL is okay'] = function () {
  return validStudyStates.map(function (state) {
    var data = {
      study_state: state,
      type: 'shield-study'
    };

    simpleTest(generateValidCommon('shield-study'), data, `study_state: ${state} should be valid MINIMAL, ${JSON.stringify(data)}`);
  });
};

tests['test shield-study FULL is okay'] = function () {
  return validStudyStates.map(function (state) {
    var data = {
      type: 'shield-study',
      study_state: state,
      study_state_fullname: 'aString',
      attributes:  {
        a: 'a'
      }
    };
    simpleTest(generateValidCommon('shield-study'), data, `study_state: ${state} should be valid MINIMAL, ${JSON.stringify(data)}`);
  });
};

tests['test shield-study-addon MINIMAL is okay'] = function () {
  var data = {
    type: 'shield-study-addon',
    attributes: {}
  };
  simpleTest(generateValidCommon('shield-study-addon'), data, `${JSON.stringify(data)}`);
};

tests['test shield-study-addon NO ATTRIBUTES is NOT okay'] = function () {
  var data = {
    type: 'shield-study-addon',
  };
  simpleTest(generateValidCommon('shield-study-addon'), data, `${JSON.stringify(data)}`, false);
};



tests['test shield-study-addon FULL is okay'] = function () {
  var data = {
    type: 'shield-study-addon',
    attributes: {
      some: 'thing',
      other: 'another'
    }
  };
  simpleTest(generateValidCommon('shield-study-addon'), data, `${JSON.stringify(data)}`);
};

tests['test shield-study-error MINIMAL is okay'] = function () {
  return validErrorSeverity.map(function (severity) {
    return validErrorSource.map(function (source) {
      var data = {
        type: 'shield-study-error',
        error_id:  genString(randInt(1,30)),
        error_source: source
      };

      simpleTest(generateValidCommon('shield-study-error'), data, `error: ${severity} ${source} should be valid MAXIMAL error, ${JSON.stringify(data)}`);
    });
  });
};

tests['test shield-study-error FULL is okay'] = function () {
  return validErrorSeverity.map(function (severity) {
    return validErrorSource.map(function (source) {
      var data = {
        type: 'shield-study-error',
        error_id:  genString(randInt(1,30)),
        error_source: source,
        severity: severity,
        message:  genString(randInt(1,30)),
        attributes:  {
          a: 'a'
        },
        error: {stack: 'thing'}
      };

      simpleTest(generateValidCommon('shield-study-error'), data, `error: ${severity} ${source} should be valid MAXIMAL error, ${JSON.stringify(data)}`);
    });
  });
};

// todo some faily things
// wrong messages
// missing fields

tests['test empty data is NOT okay'] = function () {
  var data = {
  };
  Object.keys(schemas).forEach(function (k) {
    simpleTest(generateValidCommon(k), data, `${JSON.stringify(data)}`, false);
  });
};

tests['test spaces in fields are not okay'] = function () {
  let c = generateValidCommon('shield-study-addon');
  c.study_name = ' some with spaces ';
  var data = generateShieldAddon();
  simpleTest(c, data, `${JSON.stringify(data)}`, false);
};


function runTests () {
  if (Object.keys(tests.only).length) {
    tests = tests.only;
  }

  Object.keys(tests).forEach((k) => {
    if (k === 'only') return;

    try {
      tests[k]();
      console.log('OK', k);
    } catch (err) {
      console.error('ERROR', k, err);
    }
  });
}


function generate () {
  var valid = {};
  valid['shieldStudyFULL'] = combine(generateValidCommon('shield-study'), generateShieldStudy(true));
  valid['shieldStudyMINIMAL'] = combine(generateValidCommon('shield-study'),generateShieldStudy(false));

  valid['shieldStudyAddonFULL'] = combine(generateValidCommon('shield-study-addon'),generateShieldAddon(true));
  valid['shieldStudyAddonMINIMAL'] = combine(generateValidCommon('shield-study-addon'),generateShieldAddon(false));

  valid['shieldStudyErrorFULL'] = combine(generateValidCommon('shield-study-error'),generateShieldError(true));
  valid['shieldStudyErrorMINIMAL'] = combine(generateValidCommon('shield-study-error'),generateShieldError(false));

  var file = 'example.valid.packets.json';
  // check they are valid
  Object.keys(valid).map((k) => {
    //console.log(valid[k]);

    var attempt =  validate(valid[k]);

    assert.ok(noErrors(attempt));
  });
  console.log(`writing: ${file}`);
  jsonfile.writeFileSync(file, valid, {spaces: 4});
}

function genPackets (which, n) {
  let k = 0;
  while (k < n) {
    k +=1;
    let ans = ({
      'shield-study': generateShieldStudy,
      'shield-study-error': generateShieldError,
      'shield-study-addon': generateShieldAddon
    }[which])();
    var packet = combine(generateValidCommon(which),ans);
    let val = validate(packet);
    assert.ok(noErrors(val), `node ${val.errors}`);
    console.log(JSON.stringify(packet));
  }
}

var program = require('commander');

program
  .version(VERSION)
  .description('generate and test shield packets');

program
  .command('test')
  .action(function () {runTests();});

program
  .command('example')
  .description('make a pre-baked file of example packets')
  .action(function () {generate();});


program
  .command('make')
  .description('make on packet per line of type ')
  .option('-t --type [type]', 'packet type', /^shield-study(|-addon|-error)$/i)
  .option('-n <i>', 'number to make', parseInt)
  .action(function (options) {
    genPackets(options.type, options.N);
  });

program.parse(process.argv);


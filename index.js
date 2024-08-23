"use strict";

const core = require('@lumjs/core');
const {S,N,B,def,isObj,isComplex,isArray,isNil} = core.types;
const {insert} = core.arrays.add;
const {val,get,getPath,isPath} = core.opt;
const LE = require('@lumjs/errors');

const OO = Symbol('@lumjs/opts:optimized');

// Aliases for Opts#get() and Opts#find()
const OPTS_ALIASES =
{
  'null': 'allowNull',
  'lazy': 'isLazy',
}

/**
 * A class for handling options with multiple sources.
 * @exports module:@lumjs/opts
 */
class LumOpts
{
  /**
   * Build an Opts instance.
   * 
   * @param  {...object} sources - Initial sources of options.
   * 
   * The order of sources matters, as the ones added later will override
   * the ones added earlier. Keep that in mind when adding sources.
   */
  constructor(...sources)
  {
    this.$sources = [];
    this.$curPos = -1;
    this.$curSrc = null;

    this.$errors = new LE({errorClass: TypeError});
    this.$strictProps = false;

    this.add(...sources);
  }

  /**
   * Compile current sources into a data object.
   * 
   * @returns {object} `this`
   * @private
   */
  _compile()
  {
    this.$data = Object.assign({}, ...this.$sources);
    return this;
  }

  /**
   * Handle an error
   * 
   * @param {string} msg - A summary of the error.
   * @param {*} info - Debugging information for the logs.
   * @param {(object|function)} [opts] See `@lumjs/errors#error`
   * 
   * If this is a `function` it'll be used as `opts.errorClass`.
   * 
   * @returns {object} `this`
   * @throws {Error} If fatal mode is enabled.
   * @private
   */
  _err(msg, info, opts)
  {
    if (LE.isError(opts))
    { // An error constructor was passed.
      opts = {errorClass: opts};
    }
    return this.$errors.error(msg, info, opts);
  }

  /**
   * Normalize options.
   * 
   * Auto-sets `isLazy` if it wasn't specified.
   * Applies any known aliases.
   * 
   * @param {object} opts - Options to normalize
   * @returns {object} Usually `opts`, but might be a copy.
   * @private
   */
  _opts(opts)
  {
    if (opts[OO])
    { // Already done.
      return opts;
    }

    if (opts.ro)
    {
      opts = Object.assign({}, opts);
    }

    if (isNil(opts.isLazy)
      && (isComplex(opts.lazyThis) 
      || isArray(opts.lazyArgs)))
    {
      opts.isLazy = true;
    }

    for (const akey in OPTS_ALIASES)
    {
      const okey = OPTS_ALIASES[akey];
      if (opts[okey] === undefined && opts[akey] !== undefined)
      { // An alias was found.
        opts[okey] = opts[akey];
      }
    }

    // Now remember that we've processed these options.
    opts[OO] = true;
    return opts;
  }

  /**
   * Set the fatal error handling setting.
   * 
   * Default is `false`, so errors will be logged, but not thrown.
   * 
   * @param {boolean} val - Should errors be fatal?
   * @returns {object} `this`
   */
  fatal(val)
  {
    this.$errors.fatal(val);
    return this;
  }

  /**
   * Set the strict property check setting.
   * 
   * Default is `false`, we don't care about non-existent properties. 
   *
   * @param {boolean} val - Should non-existant properties be an error?
   * @returns {object} `this`
   */
  strict(val)
  {
    if (typeof val === B)
    {
      this.$strictProps = val;
    }
    else
    {
      this._err('invalid strict value', {val});
    }

    return this;
  }

  /**
   * Set the position/offset to add new sources at.
   * 
   * This will affect subsequent calls to the `add()` method.
   * 
   * @param {number} pos - The position/offset value.
   * 
   * - A value of `-1` uses `Array#push(src))`; end of array.
   * - A value of `0` uses `Array#unshift(src)`; start of array.
   * - Any value `> 0` uses `Array#splice(pos, 0, src)`; offset from start.
   * - Any value `< -1` uses `Array#splice(pos+1, 0, src)`; offset from end.
   * 
   * The default value if none is specified is `-1`.
   * 
   * @returns {object} `this`
   * @throws {TypeError} An invalid value was passed while `fatal` was true.
   */
  at(pos)
  {
    if (typeof pos === N)
    {
      this.$curPos = pos;
    }
    else
    {
      this._err("Invalid pos value", {pos});
    }
    
    return this;
  }

  /**
   * Set the object to look for nested properties in.
   * 
   * This will affect subsequent calls to the `add()` method.
   * 
   * @param  {(object|number|boolean)} source - Source definition
   *
   * - If this is an `object` it will be used as the object directly.
   * - If this is a `number` it is the position of one of our data sources.
   *   Negative numbers count from the end of the list of sources.
   * - If this is `true` then the compiled options data at the time of the
   *   call to this method will be used.
   * - If this is `false` then the next time a `string` value is passed to
   *   `add()` the options will be compiled on demand, and that object will
   *   be used until the next call to `from()`.
   * 
   * If this is not specified, then it defaults to `false`.
   *
   * @returns {object} `this`
   * @throws {TypeError} An invalid value was passed while `fatal` was true.
   */
  from(source)
  {
    if (source === true)
    { // Use existing data as the source.
      this.$curSrc = this.$data;
    }
    else if (source === false)
    { // Auto-generate the source the next time.
      this.$curSrc = null;
    }
    else if (typeof source === N)
    { // A number will be the position of an existing source.
      const offset 
        = (source < 0)
        ? this.$sources.length + source
        : source;

      if (isObj(this.$sources[offset]))
      {
        this.$curSrc = this.$sources[offset];
      }
      else
      {
        this._err("Invalid source offset", {offset, source});
      }
    }
    else if (isObj(source))
    { // An object or function will be used as the source.
      this.$curSrc = source;
    }
    else
    {
      this._err("Invalid source", {source});
    }

    return this;
  } 

  /**
   * Add new sources of options.
   * 
   * @param  {...(object|string)} sources - Sources and positions.
   * 
   * If this is an `object` then it's a source of options to add.
   * This is the most common way of using this.
   * 
   * If this is a `string` then it's assumed to be nested property
   * of the current `from()` source, and if that property exists and
   * is an object, it will be used as the source to add. If it does
   * not exist, then the behaviour will depend on the values of the
   * `strict()` and `fatal()` modifiers.
   * 
   * @returns {object} `this`
   */
  add(...sources)
  {
    for (let source of sources)
    {
      if (source === undefined || source === null)
      { // Skip undefined or null values.
        continue;
      }

      if (typeof source === S)
      { // Try to find a nested property to include.
        if (this.$curSrc === null)
        { // Has not been initialized, let's do that now.
          this._compile();
          this.$curSrc = this.$data;
        }

        if (isObj(this.$curSrc[source]))
        { // Found a property, use it.
          source = this.$curSrc[source];
        }
        else
        { // No such property.
          if (this.$strictProps)
          {
            this._err('Property not found', {source});
          }
          continue;
        }
      }
      
      if (isObj(source))
      { // It's a source to add.
        insert(this.$sources, source, this.$curPos);
      }
      else
      { // That's not valid.
        this._err('invalid source value', {source, sources});
      }
    }

    return this._compile();
  }

  /**
   * Remove existing sources of options.
   * 
   * @param  {...object} sources - Sources to remove.
   * 
   * @returns {object} `this`
   */
  remove(...sources)
  {
    for (const source of sources)
    {
      const index = this.$sources.indexOf(source);
      if (index !== -1)
      {
        this.$sources.splice(index, 1);
      }
    }

    return this._compile();
  }

  /**
   * Remove all current sources. Resets compiled options data.
   * 
   * @returns {object} `this`
   */
  clear()
  {
    this.$sources = [];
    return this._compile();
  }

  /**
   * Get an option value from our compiled data sources.
   * 
   * This uses either `get()` or `getPath()` depending on
   * the specified arguments.
   * 
   * @param {(string|Array)} opt - The name or path of the option to get.
   * 
   * @param {object} [opts] Options
   * 
   * I will only list the options that are specific to this method,
   * as the rest are already documented in `getPath()` and related functions.
   * 
   * Note that some options like `opts.ro` and `opts.default` which are
   * supported by `getPath()` but not `get()` are usable here regardless
   * of which of those functions will end up being called. The method
   * will do the right thing to make those options work in every context.
   * 
   * @param {boolean} [opts.path] Use `getPath()` instead of `get()` ?
   * 
   * If not specified, this will be auto-determined based on the `opt`;
   * if `opt` is an `Array` or contains the `'.'` character the default
   * will be `true`, otherwise it will be `false`.
   * 
   * @returns {*} The output of the `get()` function.
   * @see module:@lumjs/core/opt.getPath
   */
  get(opt, opts={})
  {
    opts = this._opts(opts);

    const usePath = opts.path ?? isPath(opt);

    if (usePath)
    {
      return getPath(this.$data, opt, opts);
    }
    else
    {
      return get(this.$data, opt, opts.default, opts);
    }
  }

  /**
   * A wrapper around the `get()` method that can check for
   * multiple possible properties or namespaces, and will
   * return the first one that has a defined value.
   * 
   * @param {object} opts - Options
   * 
   * The same options as the `get()` instance method, which includes all
   * of the options of the `getPath()`, `get()`, and `getObjectPath()`
   * utility functions. So there's a lot of options supported here.
   * 
   * Unlike every other method and function that uses options,
   * this is a mandatory argument. You cannot skip it. If you want
   * to use all default options, just pass `{}` and presto, defaults.
   * 
   * @param  {...(string|Array)} paths - All the properties/paths to try.
   * 
   * At least one path must be specified (although if you were only
   * going to specify one, you may as well use the `get()` method
   * directly rather than this...)
   * 
   * @returns {*} Could be anything!
   */
  find(opts, ...paths)
  { 
    opts = this._opts(opts);

    const defvalue = opts.default;
    delete opts.default;
    delete opts.ro;

    for (const path of paths)
    {
      const value = this.get(path, opts);
      if (value !== undefined)
      { // Found a value.
        return value;
      }
    }

    // No matches found, use the default.
    return val(undefined, defvalue, opts);
  }

} // Opts

// An alias as this is where isPath used to live.
def(LumOpts, 'isPath', isPath);

module.exports = LumOpts;

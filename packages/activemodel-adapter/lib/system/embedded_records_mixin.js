var get = Ember.get;
var forEach = Ember.EnumerableUtils.forEach;

/**
  The EmbeddedRecordsMixin allows you to add embedded record support to your
  serializers.
  To set up embedded records, you include the mixin into the serializer and then
  define your embedded relations.

  ```js
  App.PostSerializer = DS.ActiveModelSerializer.extend(DS.EmbeddedRecordsMixin, {
    attrs: {
      comments: {embedded: 'always'}
    }
  })
  ```

  Currently only `{embedded: 'always'}` records are supported.

  @class EmbeddedRecordsMixin
  @namespace DS
*/
DS.EmbeddedRecordsMixin = Ember.Mixin.create({

  /**
    The property to use when serializing a client id.

    @property clientIdKey
    @type {String}
  */
  clientIdKey: '_clientId',

  /**
    Map of client ids, these are temporary ids used when saving new embedded records.

    They will be reconciled upon loading embedded records. Once a client id has been
    reconciled with a record that has since been given a real id, the clientIdMap 
    entry will be deleted

    @property clientIdMap
    @type {Object}
  */
  clientIdMap: Ember.computed(function () {
    return {};
  }),

  /**
    Needed because the Ember.computed above does not work (??)
  */
  init: function () {
    this._super();
    this.clientIdMap = {};
  },

  /**
    Return a unique client id

    @property createClientId
    @type {String}
  */
  createClientId: function (record) {
    var guid = Ember.guidFor(record);

    this.clientIdMap[guid] = record;
    return guid;
  },

  /**
    Serialize has-may relationship when it is configured as embedded objects.

    @method serializeHasMany
  */
  serializeHasMany: function(record, json, relationship) {
    var key   = relationship.key,
        attrs = get(this, 'attrs'),
        embed = attrs && attrs[key] && attrs[key].embedded === 'always';

    if (embed) {
      json[this.keyForAttribute(key)] = get(record, key).map(function(relation) {
        var data = relation.serialize(),
            primaryKey = get(this, 'primaryKey'),
            clientIdKey = get(this, 'clientIdKey');

        var id = get(relation, primaryKey);
        if (id) {
          data[primaryKey] = get(relation, primaryKey);
        } else {
          data[clientIdKey] = this.createClientId(relation);
        }

        return data;
      }, this);
    }
  },

  /**
    Extract embedded objects out of the payload for a single object
    and add them as sideloaded objects instead.

    @method extractSingle
  */
  extractSingle: function(store, primaryType, payload, recordId, requestType) {
    var root = this.keyForAttribute(primaryType.typeKey),
        partial = payload[root];

    updatePayloadWithEmbedded(store, this, primaryType, partial, payload);

    return this._super(store, primaryType, payload, recordId, requestType);
  },

  /**
    Extract embedded objects out of a standard payload
    and add them as sideloaded objects instead.

    @method extractArray
  */
  extractArray: function(store, type, payload) {
    var root = this.keyForAttribute(type.typeKey),
        partials = payload[Ember.String.pluralize(root)];

    forEach(partials, function(partial) {
      updatePayloadWithEmbedded(store, this, type, partial, payload);
    }, this);

    return this._super(store, type, payload);
  }
});

function updatePayloadWithEmbedded(store, serializer, type, partial, payload) {
  var attrs = get(serializer, 'attrs'),
      clientIdKey = get(serializer, 'clientIdKey'),
      parentSerializer = serializer;

  if (!attrs) {
    return;
  }

  type.eachRelationship(function(key, relationship) {
    var expandedKey, embeddedTypeKey, attribute, ids,
        config = attrs[key],
        serializer = store.serializerFor(relationship.type.typeKey),
        primaryKey = get(serializer, "primaryKey");

    if (relationship.kind !== "hasMany") {
      return;
    }

    if (config && (config.embedded === 'always' || config.embedded === 'load')) {
      // underscore forces the embedded records to be side loaded.
      // it is needed when main type === relationship.type
      embeddedTypeKey = '_' + Ember.String.pluralize(relationship.type.typeKey);
      expandedKey = this.keyForRelationship(key, relationship.kind);
      attribute  = this.keyForAttribute(key);
      ids = [];

      if (!partial[attribute]) {
        return;
      }

      payload[embeddedTypeKey] = payload[embeddedTypeKey] || [];

      forEach(partial[attribute], function(data) {
        var embeddedType = store.modelFor(relationship.type.typeKey),
            clientId, clientRecord;
        updatePayloadWithEmbedded(store, serializer, embeddedType, data, payload);
        ids.push(data[primaryKey]);
        
        clientId = data[clientIdKey];
        clientRecord = parentSerializer.clientIdMap[clientId];

        // if embedded data contains client id, mimic a createRecord/save
        if (clientRecord) {
          clientRecord.adapterWillCommit();
          store.didSaveRecord(clientRecord, data);
          delete parentSerializer.clientIdMap[clientId];

        } else {
          payload[embeddedTypeKey].push(data);
        }
      });

      partial[expandedKey] = ids;
      delete partial[attribute];
    }
  }, serializer);
}
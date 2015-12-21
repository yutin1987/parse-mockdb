'use strict';

import chai, {expect} from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import Parse from 'parse/node';
import ParseMockDB from '../src/parse-mockdb';
chai.use(sinonChai);

function createItem(name) {
  const item = new Parse.Object('Item');
  item.set('name', name);

  return item.save();
}

function createCollection(name, items) {
  const collection = new Parse.Object('Collection');
  
  collection.set('name', name);

  const itemRelation = collection.relation('items');
  (items || []).forEach((item) => {
    itemRelation.add(item);
  });

  return collection.save();
}

describe('ParseMock Parse.Relation', () => {
  beforeEach(() => {
    Parse.MockDB.mockDB();
  });

  afterEach(() => {
    Parse.MockDB.cleanUp(true);
  });

  it("should save relation and find 2 item", () => {
    return Parse.Promise.when([
      createItem('Apple'),
      createItem('Banana'),
      createItem('Skyline'),
    ])
    .then((item1, item2, item3) => {
      return createCollection('Box', [item1, item3]).then((box) => {
        const qItem = box.relation('items').query();
        return qItem.find().then((items) => {
          expect(items.length).to.equal(2);
          expect(items.map((item) => item.id)).to.have.members([ item1.id, item3.id ]);
        });
      });
    });
  });

  it('should save and then add item success', () => {
    return Parse.Promise.when([
      createItem('Apple'),
      createItem('Banana'),
      createItem('Skyline'),
    ])
    .then((item1, item2, item3) => {
      return createCollection('Box', [item1, item3]).then((box) => {
        return Parse.Promise.as()
          .then(() => {
            const qItem = box.relation('items').query();
            return qItem.find()
              .then((items) => {
                expect(items.length).to.equal(2);
                expect(items.map((item) => item.id)).to.have.members([ item1.id, item3.id ]);
              });
          })
          .then(() => {
            const itemRelation = box.relation('items');
            itemRelation.add(item2);

            return box.save().then(() => {
              const qItem = box.relation('items').query();
              return qItem.find().then((items) => {
                expect(items.length).to.equal(3);
                expect(items.map((item) => item.id)).to.have.members([ item1.id, item2.id, item3.id ]);
              });
            });
          });
      });
    });
  });

  it('should save and then remove item success', () => {
    return Parse.Promise.when([
      createItem('Apple'),
      createItem('Banana'),
      createItem('Skyline'),
    ])
    .then((item1, item2, item3) => {
      return createCollection('Box', [item1, item3]).then((box) => {
        return Parse.Promise.as()
          .then(() => {
            const qItem = box.relation('items').query();
            return qItem.find()
              .then((items) => {
                expect(items.length).to.equal(2);
                expect(items.map((item) => item.id)).to.have.members([ item1.id, item3.id ]);
              });
          })
          .then(() => {
            const itemRelation = box.relation('items');
            itemRelation.remove(item1);

            return box.save().then(() => {
              const qItem = box.relation('items').query();
              return qItem.find().then((items) => {
                expect(items.length).to.equal(1);
                expect(items.map((item) => item.id)).to.have.members([ item3.id ]);
              });
            });
          });
      });
    });
  });

  describe('beforeSave', () => {
    describe('create', () => {
      it('should have saved and get 2 items when add item in beforeSave', () => {
        return Parse.Promise.when([
          createItem('Apple'),
          createItem('Banana'),
          createItem('Skyline'),
        ])
        .then((item1, item2, item3) => {
          const beforeSaveSpy = sinon.spy();

          Parse.Cloud.beforeSave('Collection', (request, response) => {
            const itemRelation = request.object.relation('items');
            itemRelation.add(item3);

            beforeSaveSpy(request);
            response.success();
          });

          return createCollection('Box', [item1]).then((box) => {
            return Parse.Promise.as()
              .then(() => {
                const qItem = box.relation('items').query();
                return qItem.find()
                  .then((items) => {
                    expect(items.length).to.equal(2);
                    expect(items.map((item) => item.id)).to.have.members([ item1.id, item3.id ]);
                  });
              });
          });
        });
      });
      it('should have saved and get a item when remove item in beforeSave', () => {
        return Parse.Promise.when([
          createItem('Apple'),
          createItem('Banana'),
          createItem('Skyline'),
        ])
        .then((item1, item2, item3) => {
          const beforeSaveSpy = sinon.spy();

          Parse.Cloud.beforeSave('Collection', (request, response) => {
            const itemRelation = request.object.relation('items');
            itemRelation.remove(item3);

            beforeSaveSpy(request);
            response.success();
          });

          return createCollection('Box', [item1, item3]).then((box) => {
            return Parse.Promise.as()
              .then(() => {
                const qItem = box.relation('items').query();
                return qItem.find()
                  .then((items) => {
                    expect(items.length).to.equal(1);
                    expect(items.map((item) => item.id)).to.have.members([ item1.id ]);
                  });
              });
          });
        });
      });
    });
  });
});

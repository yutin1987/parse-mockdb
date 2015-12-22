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

describe('ParseMock Parse.Cloud.run', () => {
  beforeEach(() => {
    Parse.MockDB.mockDB();
  });

  afterEach(() => {
    Parse.MockDB.cleanUp(true);
  });

  it("should save item and find 2 item using cloud run", () => {
    const beforeSaveSpy = sinon.spy();

    Parse.Cloud.define('findItem', (request, response) => {
      beforeSaveSpy(request);

      const qItem = new Parse.Query('Item');
      qItem.equalTo('name', 'Skyline');
      qItem.find().then((result) => response.success(result), response.error);
    });

    return Parse.Promise.when([
      createItem('Skyline'),
      createItem('Banana'),
      createItem('Skyline'),
    ])
    .then((item1, item2, item3) => {
      return Parse.Cloud.run('findItem').then((items) => {
        expect(items.length).to.equal(2);
        expect(items[0]).to.be.an.instanceof(Parse.Object);
        expect(items.map((item) => item.id)).to.have.members([ item1.id, item3.id ]);
      }, (err) => {
        throw new Error("should not have error");
      });
    });
  });
});

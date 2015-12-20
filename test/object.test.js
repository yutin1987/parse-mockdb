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
  item.set('size', ['large', 'medium']);

  return item.save();
}

describe('ParseMock Parse.Object', () => {
  beforeEach(() => {
    Parse.MockDB.mockDB();
  });

  afterEach(() => {
    Parse.MockDB.cleanUp();
  });

  it("should save object", () => {
    return createItem('Apple')
      .then((item) => {
        expect(item.id).to.exist;
        expect(item.get('name')).to.equal('Apple');
      });
  });

  it('should save and find a item', () => {
    return Parse.Promise.when([
        createItem('Apple'),
        createItem('Box'),
      ])
      .then((item1, item2) => {
        expect(item1.get('name')).to.equal('Apple');
        expect(item2.get('name')).to.equal('Box');

        const qItem = new Parse.Query('Item');
        qItem.equalTo("name", 'Apple');
        return qItem.find().then((item) => {
          expect(item[0].id).to.exist;
          expect(item[0].get('name')).to.equal('Apple');
        });
      });
  });

  it('should save and get a item', () => {
    return Parse.Promise.when([
        createItem('Apple'),
        createItem('Box'),
      ])
      .then((item1, item2) => {
        expect(item1.get('name')).to.equal('Apple');
        expect(item2.get('name')).to.equal('Box');

        const qItem = new Parse.Query('Item');
        qItem.equalTo("name", 'Apple');
        return qItem.get(item1.id).then((item) => {
          expect(item.get('name')).to.equal('Apple');
        });
      });
  });

  it('should save and then update success', () => {
    return Parse.Promise.when([
        createItem('Apple'),
        createItem('Box'),
      ])
      .then((item1, item2) => {
        expect(item1.get('name')).to.equal('Apple');
        expect(item2.get('name')).to.equal('Box');

        item1.addUnique('size', 'small');
        item1.addUnique('size', 'large');
        item2.add('size', 'small');
        item2.add('size', 'large');
        return Parse.Promise.when([
          item1.save({name: 'Book'}),
          item2.save({color: 'red'}),
        ])
        .then(() => {
          const qItem = new Parse.Query('Item');

          return Parse.Promise.when([
            qItem.get(item1.id),
            qItem.get(item2.id),
          ])
          .then((item1, item2) => {
            expect(item1.get('name')).to.equal('Book');
            expect(item1.get('size').length).to.equal(3);
            expect(item1.get('size')).to.have.members([ 'large', 'medium', 'small' ]);
            expect(item2.get('color')).to.equal('red');
            expect(item2.get('size')).to.have.members([ 'large', 'medium', 'small' ]);
            expect(item2.get('size').length).to.equal(4);
          });
        });
      });
  });

  describe('beforeSave', () => {
    describe('create', () => {
      it('should not have saved when beforeSave is error', () => {
        const beforeSaveSpy = sinon.spy();

        Parse.Cloud.beforeSave('Item', (request, response) => {
          beforeSaveSpy(request);
          response.error('beforeSave is error');
        });

        return createItem('Apple')
          .then(() => {
            return Parse.Promise.error('should not call success');
          }, (error) => {
            expect(beforeSaveSpy).to.have.been.calledOnce;
            expect(error.message).to.equal('beforeSave is error');

            const qItem = new Parse.Query('Item');
            return qItem.count().then((count) => {
              expect(count).to.equal(0);
            });
          });
      });

      it('should have saved when beforeSave is success', () => {
        const beforeSaveSpy = sinon.spy();

        Parse.Cloud.beforeSave('Item', (request, response) => {
          beforeSaveSpy(request);
          response.success('beforeSave is error');
        });

        return createItem('Apple')
          .then((item) => {
            expect(beforeSaveSpy).to.have.been.calledOnce;
            expect(beforeSaveSpy.getCall(0).args[0].master).to.be.false;
            expect(item.id).to.exist;

            const qItem = new Parse.Query('Item');
            return qItem.count().then((count) => {
              expect(count).to.equal(1);
            });
          });
      });

      it('should get master key when using {useMasterKey: true}', () => {
        const beforeSaveSpy = sinon.spy();

        Parse.Cloud.beforeSave('Item', (request, response) => {
          beforeSaveSpy(request);
          response.success('beforeSave is error');
        });

        const item = new Parse.Object('Item');
        return item.save({name: 'Apple'}, {useMasterKey: true}).then(() => {
          expect(beforeSaveSpy).to.have.been.calledOnce;
          expect(beforeSaveSpy.getCall(0).args[0].master).to.be.true;
          expect(item.id).to.exist;

          const qItem = new Parse.Query('Item');
          return qItem.count().then((count) => {
            expect(count).to.equal(1);
          });
        });
      });

      it('should get date type when save date', () => {
        const beforeSaveSpy = sinon.spy();

        Parse.Cloud.beforeSave('Item', (request, response) => {
          beforeSaveSpy(request);
          response.success('beforeSave is error');
        });

        const item = new Parse.Object('Item');
        return item.save({date: new Date()}, {useMasterKey: true}).then(() => {
          expect(beforeSaveSpy).to.have.been.calledOnce;
          expect(beforeSaveSpy.getCall(0).args[0].object.get('date')).to.be.an('date');
          expect(item.id).to.exist;

          const qItem = new Parse.Query('Item');
          return qItem.count().then((count) => {
            expect(count).to.equal(1);
          });
        });
      });
    });

    describe('update', () => {
      it('should not have updated when beforeSave is error', () => {
        const beforeSaveSpy = sinon.spy();

        return createItem('Apple').then((item) => {
          Parse.Cloud.beforeSave('Item', (request, response) => {
            beforeSaveSpy(request);
            response.error('beforeSave is error');
          });

          expect(item.id).to.exist;
          expect(item.get('name')).to.equal('Apple');

          return item.save({name: 'Box'}).then(() => {
            return Parse.Promise.error('should not call success');
          }, (error) => {
            expect(beforeSaveSpy).to.have.been.calledOnce;
            expect(error.message).to.equal('beforeSave is error');

            const qItem = new Parse.Query('Item');
            return qItem.first().then((newItem) => {
              expect(newItem.id).to.equal(item.id);
              expect(newItem.get('name')).to.equal('Apple');
            });
          });
        });
      });

      it('should have updated when beforeSave is success', () => {
        const beforeSaveSpy = sinon.spy();

        return createItem('Apple').then((item) => {
          Parse.Cloud.beforeSave('Item', (request, response) => {
            beforeSaveSpy(request);
            response.success();
          });

          expect(item.id).to.exist;
          expect(item.get('name')).to.equal('Apple');

          return item.save({color: 'red'}).then((item) => {
            expect(beforeSaveSpy).to.have.been.calledOnce;
            expect(beforeSaveSpy.getCall(0).args[0].object.dirtyKeys().length).to.equal(1);
            expect(beforeSaveSpy.getCall(0).args[0].object.dirtyKeys()).to.have.members([ 'color' ]);
            expect(beforeSaveSpy.getCall(0).args[0].master).to.be.false;
            expect(item.id).to.exist;

            const qItem = new Parse.Query('Item');
            return qItem.first().then((newItem) => {
              expect(newItem.id).to.equal(item.id);
              expect(newItem.get('color')).to.equal('red');
            });
          });
        });
      });

      it('should get master key when updated using {useMasterKey: true}', () => {
        const beforeSaveSpy = sinon.spy();

        return createItem('Apple').then((item) => {
          Parse.Cloud.beforeSave('Item', (request, response) => {
            beforeSaveSpy(request);
            response.success();
          });

          expect(item.id).to.exist;
          expect(item.get('name')).to.equal('Apple');

          return item.save({name: 'Box'}, {useMasterKey: true}).then((item) => {
            expect(beforeSaveSpy).to.have.been.calledOnce;
            expect(beforeSaveSpy.getCall(0).args[0].master).to.be.true;
            expect(item.id).to.exist;

            const qItem = new Parse.Query('Item');
            return qItem.first().then((newItem) => {
              expect(newItem.id).to.equal(item.id);
              expect(newItem.get('name')).to.equal('Box');
            });
          });
        });
      });
    });
  });
});

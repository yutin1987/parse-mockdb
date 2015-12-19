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

        return Parse.Promise.when([
          item1.save({name: 'Book'}),
          item2.save({size: 'big'}),
        ])
        .then(() => {
          const qItem = new Parse.Query('Item');

          return Parse.Promise.when([
            qItem.get(item1.id),
            qItem.get(item2.id),
          ])
          .then((item1, item2) => {
            expect(item1.get('name')).to.equal('Book');
            expect(item2.get('size')).to.equal('big');
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

          return item.save({name: 'Box'}).then((item) => {
            expect(beforeSaveSpy).to.have.been.calledOnce;
            expect(beforeSaveSpy.getCall(0).args[0].master).to.be.false;
            expect(item.id).to.exist;

            const qItem = new Parse.Query('Item');
            return qItem.first().then((newItem) => {
              expect(newItem.id).to.equal(item.id);
              expect(newItem.get('name')).to.equal('Box');
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

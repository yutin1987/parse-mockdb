'use strict';

import chai, {expect} from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import Parse from 'parse/node';
import ParseMockDB from '../src/parse-mockdb';
chai.use(sinonChai);

function createUser(name, username, password) {
  const user = new Parse.User();
  user.set('name', name);
  if (username) user.set('username', username);
  if (password) user.set('password', password);

  return user.save();
}

function createItem(name) {
  const item = new Parse.Object('Item');
  return item.save({ name });
}

describe('ParseMock Parse.User', () => {
  beforeEach(() => {
    Parse.MockDB.mockDB();
  });

  afterEach(() => {
    Parse.MockDB.cleanUp(true);
  });

  it("should save user", () => {
    return createUser('Tom')
      .then((user) => expect(user.get('name')).to.equal('Tom'));
  });

  it('should save and find a user', () => {
    return Parse.Promise.when([
        createUser('Tom'),
        createUser('Justin'),
      ])
      .then((user1, user2) => {
        expect(user1.get('name')).to.equal('Tom');
        expect(user2.get('name')).to.equal('Justin');

        const qUser = new Parse.Query(Parse.User);
        qUser.equalTo("name", 'Tom');
        return qUser.find().then((user) => {
          expect(user[0].get('name')).to.equal('Tom');
        });
      });
  });

  it('should save and get a user', () => {
    return Parse.Promise.when([
        createUser('Tom'),
        createUser('Justin'),
      ])
      .then((user1, user2) => {
        expect(user1.get('name')).to.equal('Tom');
        expect(user2.get('name')).to.equal('Justin');

        const qUser = new Parse.Query(Parse.User);
        qUser.equalTo("name", 'Tom');
        return qUser.get(user1.id).then((user) => {
          expect(user.get('name')).to.equal('Tom');
        });
      });
  });

  it('should save and then update success', () => {
    return Parse.Promise.when([
        createUser('Tom'),
        createUser('Justin'),
      ])
      .then((user1, user2) => {
        expect(user1.get('name')).to.equal('Tom');
        expect(user2.get('name')).to.equal('Justin');

        return Parse.Promise.when([
          user1.save({name: 'Amy'}),
          user2.save({email: 'taiwan@gmail.com'}),
        ])
        .then(() => {
          const qUser = new Parse.Query(Parse.User);

          return Parse.Promise.when([
            qUser.get(user1.id),
            qUser.get(user2.id),
          ])
          .then((user1, user2) => {
            expect(user1.get('name')).to.equal('Amy');
            expect(user2.get('email')).to.equal('taiwan@gmail.com');
          });
        });
      });
  });

  // it('should login success when username & password', () => {
  it('should login success when username & password is matched', () => {
    return createUser('Justin', 'myname', '0123456789')
      .then((user) => {
        return Parse.User.logIn('myname', '0123456789').then((reply) => {
          expect(reply.id).to.equal(user.id);
        }, () => {
          throw new Error("should not have error");
        });
      });
  });

  it('should login success when username & password is mismatched', () => {
    return createUser('Justin', 'myname', '0123456789')
      .then((user) => {
        return Parse.User.logIn('myname', '9876543210').then((reply) => {
          throw new Error("should not have success");
        }, (err) => {
          expect(err.message).to.exist;
          return Parse.Promise.as();
        });
      });
  });

  describe('beforeSave', () => {
    it('should get user info after login', () => {
      const beforeSaveSpy = sinon.spy();

      Parse.Cloud.beforeSave('Item', (request, response) => {
        beforeSaveSpy(request);
        response.success();
      });

      return createUser('Justin', 'myname', '0123456789')
        .then((user) => {
          return Parse.User.logIn('myname', '0123456789').then(() => {
            return createItem('Apple').then(() => {
              expect(beforeSaveSpy).to.have.been.calledOnce;
              expect(beforeSaveSpy.getCall(0).args[0].user).to.exist;
            });
          })
          .fail((err) => {
            throw new Error("should not have error");
          });
        });
    });
  });
});

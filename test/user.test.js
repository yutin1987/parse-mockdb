'use strict';

import chai, {expect} from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import Parse from 'parse/node';
import ParseMockDB from '../src/parse-mockdb';
chai.use(sinonChai);

function createUser(name) {
  const user = new Parse.User();
  user.set('name', name);

  return user.save();
}

describe('ParseMock Parse.User', () => {
  beforeEach(() => {
    Parse.MockDB.mockDB();
  });

  afterEach(() => {
    Parse.MockDB.cleanUp();
  });

  it("should save user", () => {
    return createUser('Tom')
      .then((user) => expect(user.get('name')).to.equal('Tom'));
  });

  it('should save and find a user', function () {
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

  it('should save and get a user', function () {
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

  it('should save and then update success', function () {
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
});

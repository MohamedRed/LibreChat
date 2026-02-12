const { logger } = require('@librechat/data-schemas');
const { createTempChatExpirationDate } = require('@librechat/api');
const { getMessages, deleteMessages } = require('./Message');
const { Conversation } = require('~/db/models');

/**
 * Searches for a conversation by conversationId and returns a lean document with only conversationId and user.
 * @param {string} conversationId - The conversation's ID.
 * @returns {Promise<{conversationId: string, user: string, tenantId?: string} | null>} The conversation object with selected fields or null if not found.
 */
const searchConversation = async (conversationId, tenantId) => {
  try {
    const filter = tenantId ? { conversationId, tenantId } : { conversationId };
    return await Conversation.findOne(filter, 'conversationId user tenantId').lean();
  } catch (error) {
    logger.error('[searchConversation] Error searching conversation', error);
    throw new Error('Error searching conversation');
  }
};

/**
 * Retrieves a single conversation for a given user and conversation ID.
 * @param {string} user - The user's ID.
 * @param {string} conversationId - The conversation's ID.
 * @returns {Promise<TConversation>} The conversation object.
 */
const getConvo = async (user, conversationId, tenantId) => {
  try {
    const filter = tenantId ? { user, conversationId, tenantId } : { user, conversationId };
    return await Conversation.findOne(filter).lean();
  } catch (error) {
    logger.error('[getConvo] Error getting single conversation', error);
    throw new Error('Error getting single conversation');
  }
};

const deleteNullOrEmptyConversations = async () => {
  try {
    const filter = {
      $or: [
        { conversationId: null },
        { conversationId: '' },
        { conversationId: { $exists: false } },
      ],
    };

    const result = await Conversation.deleteMany(filter);

    // Delete associated messages
    const messageDeleteResult = await deleteMessages(filter);

    logger.info(
      `[deleteNullOrEmptyConversations] Deleted ${result.deletedCount} conversations and ${messageDeleteResult.deletedCount} messages`,
    );

    return {
      conversations: result,
      messages: messageDeleteResult,
    };
  } catch (error) {
    logger.error('[deleteNullOrEmptyConversations] Error deleting conversations', error);
    throw new Error('Error deleting conversations with null or empty conversationId');
  }
};

/**
 * Searches for a conversation by conversationId and returns associated file ids.
 * @param {string} conversationId - The conversation's ID.
 * @returns {Promise<string[] | null>}
 */
const getConvoFiles = async (conversationId, tenantId) => {
  try {
    const filter = tenantId ? { conversationId, tenantId } : { conversationId };
    return (await Conversation.findOne(filter, 'files').lean())?.files ?? [];
  } catch (error) {
    logger.error('[getConvoFiles] Error getting conversation files', error);
    throw new Error('Error getting conversation files');
  }
};

module.exports = {
  getConvoFiles,
  searchConversation,
  deleteNullOrEmptyConversations,
  /**
   * Saves a conversation to the database.
   * @param {Object} req - The request object.
   * @param {string} conversationId - The conversation's ID.
   * @param {Object} metadata - Additional metadata to log for operation.
   * @returns {Promise<TConversation>} The conversation object.
   */
  saveConvo: async (req, { conversationId, newConversationId, ...convo }, metadata) => {
    try {
      if (metadata?.context) {
        logger.debug(`[saveConvo] ${metadata.context}`);
      }

      const tenantId = req.user?.tenantId;
      const messageFilter = tenantId ? { conversationId, tenantId } : { conversationId };
      const messages = await getMessages(messageFilter, '_id');
      const update = { ...convo, messages, user: req.user.id, tenantId };

      if (newConversationId) {
        update.conversationId = newConversationId;
      }

      if (req?.body?.isTemporary) {
        try {
          const appConfig = req.config;
          update.expiredAt = createTempChatExpirationDate(appConfig?.interfaceConfig);
        } catch (err) {
          logger.error('Error creating temporary chat expiration date:', err);
          logger.info(`---\`saveConvo\` context: ${metadata?.context}`);
          update.expiredAt = null;
        }
      } else {
        update.expiredAt = null;
      }

      /** @type {{ $set: Partial<TConversation>; $unset?: Record<keyof TConversation, number> }} */
      const updateOperation = { $set: update };
      if (metadata && metadata.unsetFields && Object.keys(metadata.unsetFields).length > 0) {
        updateOperation.$unset = metadata.unsetFields;
      }

      /** Note: the resulting Model object is necessary for Meilisearch operations */
      const conversation = await Conversation.findOneAndUpdate(
        { conversationId, user: req.user.id, tenantId },
        updateOperation,
        {
          new: true,
          upsert: true,
        },
      );

      return conversation.toObject();
    } catch (error) {
      logger.error('[saveConvo] Error saving conversation', error);
      if (metadata && metadata?.context) {
        logger.info(`[saveConvo] ${metadata.context}`);
      }
      return { message: 'Error saving conversation' };
    }
  },
  bulkSaveConvos: async (conversations) => {
    try {
      const bulkOps = conversations.map((convo) => ({
        updateOne: {
          filter: {
            conversationId: convo.conversationId,
            user: convo.user,
            ...(convo.tenantId ? { tenantId: convo.tenantId } : {}),
          },
          update: convo,
          upsert: true,
          timestamps: false,
        },
      }));

      const result = await Conversation.bulkWrite(bulkOps);
      return result;
    } catch (error) {
      logger.error('[bulkSaveConvos] Error saving conversations in bulk', error);
      throw new Error('Failed to save conversations in bulk.');
    }
  },
  getConvosByCursor: async (
    user,
    {
      cursor,
      limit = 25,
      isArchived = false,
      tags,
      search,
      sortBy = 'updatedAt',
      sortDirection = 'desc',
      tenantId,
    } = {},
  ) => {
    const filters = [{ user }];
    if (tenantId) {
      filters.push({ tenantId });
    }
    if (isArchived) {
      filters.push({ isArchived: true });
    } else {
      filters.push({ $or: [{ isArchived: false }, { isArchived: { $exists: false } }] });
    }

    if (Array.isArray(tags) && tags.length > 0) {
      filters.push({ tags: { $in: tags } });
    }

    filters.push({ $or: [{ expiredAt: null }, { expiredAt: { $exists: false } }] });

    if (search) {
      try {
        const meiliFilter = tenantId
          ? `user = "${user}" AND tenantId = "${tenantId}"`
          : `user = "${user}"`;
        const meiliResults = await Conversation.meiliSearch(search, { filter: meiliFilter });
        const matchingIds = Array.isArray(meiliResults.hits)
          ? meiliResults.hits.map((result) => result.conversationId)
          : [];
        if (!matchingIds.length) {
          return { conversations: [], nextCursor: null };
        }
        filters.push({ conversationId: { $in: matchingIds } });
      } catch (error) {
        logger.error('[getConvosByCursor] Error during meiliSearch', error);
        throw new Error('Error during meiliSearch');
      }
    }

    const validSortFields = ['title', 'createdAt', 'updatedAt'];
    if (!validSortFields.includes(sortBy)) {
      throw new Error(
        `Invalid sortBy field: ${sortBy}. Must be one of ${validSortFields.join(', ')}`,
      );
    }
    const finalSortBy = sortBy;
    const finalSortDirection = sortDirection === 'asc' ? 'asc' : 'desc';

    let cursorFilter = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
        const { primary, secondary } = decoded;
        const primaryValue = finalSortBy === 'title' ? primary : new Date(primary);
        const secondaryValue = new Date(secondary);
        const op = finalSortDirection === 'asc' ? '$gt' : '$lt';

        cursorFilter = {
          $or: [
            { [finalSortBy]: { [op]: primaryValue } },
            {
              [finalSortBy]: primaryValue,
              updatedAt: { [op]: secondaryValue },
            },
          ],
        };
      } catch (err) {
        logger.warn('[getConvosByCursor] Invalid cursor format, starting from beginning');
      }
      if (cursorFilter) {
        filters.push(cursorFilter);
      }
    }

    const query = filters.length === 1 ? filters[0] : { $and: filters };

    try {
      const sortOrder = finalSortDirection === 'asc' ? 1 : -1;
      const sortObj = { [finalSortBy]: sortOrder };

      if (finalSortBy !== 'updatedAt') {
        sortObj.updatedAt = sortOrder;
      }

      const convos = await Conversation.find(query)
        .select(
          'conversationId endpoint title createdAt updatedAt user model agent_id assistant_id spec iconURL',
        )
        .sort(sortObj)
        .limit(limit + 1)
        .lean();

      let nextCursor = null;
      if (convos.length > limit) {
        convos.pop(); // Remove extra item used to detect next page
        // Create cursor from the last RETURNED item (not the popped one)
        const lastReturned = convos[convos.length - 1];
        const primaryValue = lastReturned[finalSortBy];
        const primaryStr = finalSortBy === 'title' ? primaryValue : primaryValue.toISOString();
        const secondaryStr = lastReturned.updatedAt.toISOString();
        const composite = { primary: primaryStr, secondary: secondaryStr };
        nextCursor = Buffer.from(JSON.stringify(composite)).toString('base64');
      }

      return { conversations: convos, nextCursor };
    } catch (error) {
      logger.error('[getConvosByCursor] Error getting conversations', error);
      throw new Error('Error getting conversations');
    }
  },
  getConvosQueried: async (user, convoIds, cursor = null, limit = 25, tenantId) => {
    try {
      if (!convoIds?.length) {
        return { conversations: [], nextCursor: null, convoMap: {} };
      }

      const conversationIds = convoIds.map((convo) => convo.conversationId);

      const query = {
        user,
        conversationId: { $in: conversationIds },
        $or: [{ expiredAt: { $exists: false } }, { expiredAt: null }],
        ...(tenantId ? { tenantId } : {}),
      };
      const results = await Conversation.find(query).lean();

      results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      let filtered = results;
      if (cursor && cursor !== 'start') {
        const cursorDate = new Date(cursor);
        filtered = results.filter((convo) => new Date(convo.updatedAt) < cursorDate);
      }

      const limited = filtered.slice(0, limit + 1);
      let nextCursor = null;
      if (limited.length > limit) {
        limited.pop(); // Remove extra item used to detect next page
        // Create cursor from the last RETURNED item (not the popped one)
        nextCursor = limited[limited.length - 1].updatedAt.toISOString();
      }

      const convoMap = {};
      limited.forEach((convo) => {
        convoMap[convo.conversationId] = convo;
      });

      return { conversations: limited, nextCursor, convoMap };
    } catch (error) {
      logger.error('[getConvosQueried] Error getting conversations', error);
      throw new Error('Error fetching conversations');
    }
  },
  getConvo,
  /* chore: this method is not properly error handled */
  getConvoTitle: async (user, conversationId, tenantId) => {
    try {
      const convo = await getConvo(user, conversationId, tenantId);
      /* ChatGPT Browser was triggering error here due to convo being saved later */
      if (convo && !convo.title) {
        return null;
      } else {
        // TypeError: Cannot read properties of null (reading 'title')
        return convo?.title || 'New Chat';
      }
    } catch (error) {
      logger.error('[getConvoTitle] Error getting conversation title', error);
      throw new Error('Error getting conversation title');
    }
  },
  /**
   * Asynchronously deletes conversations and associated messages for a given user and filter.
   *
   * @async
   * @function
   * @param {string|ObjectId} user - The user's ID.
   * @param {Object} filter - Additional filter criteria for the conversations to be deleted.
   * @returns {Promise<{ n: number, ok: number, deletedCount: number, messages: { n: number, ok: number, deletedCount: number } }>}
   *          An object containing the count of deleted conversations and associated messages.
   * @throws {Error} Throws an error if there's an issue with the database operations.
   *
   * @example
   * const user = 'someUserId';
   * const filter = { someField: 'someValue' };
   * const result = await deleteConvos(user, filter);
   * logger.error(result); // { n: 5, ok: 1, deletedCount: 5, messages: { n: 10, ok: 1, deletedCount: 10 } }
   */
  deleteConvos: async (user, filter) => {
    try {
      const userFilter = { ...filter, user };
      const conversations = await Conversation.find(userFilter).select('conversationId');
      const conversationIds = conversations.map((c) => c.conversationId);

      if (!conversationIds.length) {
        throw new Error('Conversation not found or already deleted.');
      }

      const deleteConvoResult = await Conversation.deleteMany(userFilter);

      const deleteMessagesResult = await deleteMessages({
        conversationId: { $in: conversationIds },
        ...(filter?.tenantId ? { tenantId: filter.tenantId } : {}),
      });

      return { ...deleteConvoResult, messages: deleteMessagesResult };
    } catch (error) {
      logger.error('[deleteConvos] Error deleting conversations and messages', error);
      throw error;
    }
  },
};

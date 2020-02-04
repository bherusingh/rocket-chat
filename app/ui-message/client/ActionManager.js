import { UIKitInteractionType, UIKitIncomingInteractionType } from '@rocket.chat/apps-engine/definition/uikit';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import EventEmitter from 'wolfy87-eventemitter';

import Notifications from '../../notifications/client/lib/Notifications';
import { CachedCollectionManager } from '../../ui-cached-collection';
import { modal } from '../../ui-utils/client/lib/modal';
import { APIClient } from '../../utils';

const events = new EventEmitter();

export const on = (...args) => {
	events.on(...args);
};

export const off = (...args) => {
	events.off(...args);
};

const TRIGGER_TIMEOUT = 5000;

const triggersId = new Map();

const instances = new Map();

const invalidateTriggerId = (id) => {
	const appId = triggersId.get(id);
	triggersId.delete(id);
	return appId;
};

export const generateTriggerId = (appId) => {
	const triggerId = Random.id();
	triggersId.set(triggerId, appId);
	setTimeout(invalidateTriggerId, TRIGGER_TIMEOUT, triggerId);
	return triggerId;
};

const handlePayloadUserInteraction = (type, { /* appId,*/ triggerId, ...data }) => {
	if (!triggersId.has(triggerId)) {
		return;
	}
	const appId = invalidateTriggerId(triggerId);
	if (!appId) {
		return;
	}

	// TODO not sure this will always have 'view.id'
	const { view: { id: viewId } } = data;

	if (!viewId) {
		return;
	}

	if (['errors'].includes(type)) {
		events.emit(viewId, {
			type,
			triggerId,
			viewId,
			appId,
			...data,
		});
		return type;
	}

	if ([UIKitInteractionType.MODAL_UPDATE].includes(type)) {
		events.emit(viewId, {
			type,
			triggerId,
			viewId,
			appId,
			...data,
		});
		return UIKitInteractionType.MODAL_UPDATE;
	}

	if ([UIKitInteractionType.MODAL_OPEN].includes(type)) {
		const instance = modal.push({
			template: 'ModalBlock',
			modifier: 'uikit',
			closeOnEscape: false,
			data: {
				triggerId,
				viewId,
				appId,
				...data,
			},
		});
		instances.set(viewId, instance);
		return UIKitInteractionType.MODAL_OPEN;
	}

	return UIKitInteractionType.MODAL_ClOSE;
};

export const triggerAction = async ({ type, actionId, appId, rid, mid, viewId, ...rest }) => new Promise(async (resolve, reject) => {
	const triggerId = generateTriggerId(appId);

	const payload = rest.payload || rest;

	setTimeout(reject, TRIGGER_TIMEOUT, triggerId);

	const { type: interactionType, ...data } = await APIClient.post(
		`apps/uikit/${ appId }`,
		{ type, actionId, payload, mid, rid, triggerId, viewId },
	);

	return resolve(handlePayloadUserInteraction(interactionType, data));
});

export const triggerBlockAction = (options) => triggerAction({ type: UIKitIncomingInteractionType.BLOCK, ...options });
export const triggerSubmitView = async ({ viewId, ...options }) => {
	const close = () => {
		const instance = instances.get(viewId);

		if (instance) {
			instance.close();
			instances.delete(viewId);
		}
	};

	try {
		const result = await triggerAction({ type: UIKitIncomingInteractionType.VIEW_SUBMIT, viewId, ...options });
		if (UIKitInteractionType.MODAL_CLOSE === result) {
			close();
		}
	} finally {
		close();
	}
};
export const triggerCancel = async ({ viewId, ...options }) => {
	const instance = instances.get(viewId);
	try {
		await triggerAction({ type: UIKitIncomingInteractionType.VIEW_CLOSED, viewId, ...options });
	} finally {
		if (instance) {
			instance.close();
			instances.delete(viewId);
		}
	}
};

Meteor.startup(() =>
	CachedCollectionManager.onLogin(() =>
		Notifications.onUser('uiInteraction', ({ type, ...data }) => {
			handlePayloadUserInteraction(type, data);
		}),
	),
);

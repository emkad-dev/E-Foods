#!/usr/bin/env node

const env = process.env;

const parseNumber = (value, fallback) => {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : fallback;
};

const parseJsonEnv = (value) => {
  if (!value || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Unable to parse JSON env value: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const nowMs = () => performance.now();

const config = {
  appRpcUrl: env.APP_RPC_URL?.trim() || env.BACKEND_RPC_URL?.trim() || '',
  anonKey: env.ANON_KEY?.trim() || env.SUPABASE_ANON_KEY?.trim() || '',
  authToken: env.AUTH_TOKEN?.trim() || '',
  concurrency: parseNumber(env.CONCURRENCY, 100),
  durationMs: parseNumber(env.DURATION_SECONDS, 600) * 1000,
  notificationsUrl: env.NOTIFICATIONS_URL?.trim() || '',
  placeOrderDraft: parseJsonEnv(env.PLACE_ORDER_DRAFT_JSON),
  initializePaymentDraft: parseJsonEnv(env.INITIALIZE_PAYMENT_DRAFT_JSON),
  publicCatalogUrl: env.PUBLIC_CATALOG_URL?.trim() || '',
  queueDrainerUrl: env.QUEUE_DRAINER_URL?.trim() || '',
  queueWorkerToken: env.QUEUE_WORKER_TOKEN?.trim() || '',
  restaurantId: env.RESTAURANT_ID?.trim() || '',
  orderId: env.ORDER_ID?.trim() || '',
  mutationsEnabled: env.CONFIRM_LOAD_TEST_MUTATIONS === 'yes',
  notificationTargetRoles: parseJsonEnv(env.NOTIFICATION_TARGET_ROLES_JSON) ?? [],
  notificationTargetUserIds: parseJsonEnv(env.NOTIFICATION_TARGET_USER_IDS_JSON) ?? [],
  notificationTitle: env.NOTIFICATION_TITLE?.trim() || 'Load test notice',
  notificationBody: env.NOTIFICATION_BODY?.trim() || 'This is a load-test notification.',
};

if (!config.publicCatalogUrl) {
  throw new Error('PUBLIC_CATALOG_URL is required for the load test harness.');
}

const stats = new Map();

const recordSample = (entry, durationMs) => {
  const cap = 5000;
  if (entry.samples.length < cap) {
    entry.samples.push(durationMs);
    return;
  }

  const nextIndex = Math.floor(Math.random() * entry.count);
  if (nextIndex < cap) {
    entry.samples[nextIndex] = durationMs;
  }
};

const recordMetric = (name, durationMs, ok, errorMessage = null) => {
  let entry = stats.get(name);
  if (!entry) {
    entry = {
      count: 0,
      errors: 0,
      max: 0,
      min: Number.POSITIVE_INFINITY,
      samples: [],
      sum: 0,
    };
    stats.set(name, entry);
  }

  entry.count += 1;
  entry.sum += durationMs;
  entry.max = Math.max(entry.max, durationMs);
  entry.min = Math.min(entry.min, durationMs);
  if (!ok) {
    entry.errors += 1;
    if (errorMessage) {
      entry.lastError = errorMessage;
    }
  }

  recordSample(entry, durationMs);
};

const percentile = (values, pct) => {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
};

const summarizeNumber = (value) => (Number.isFinite(value) ? value.toFixed(1) : '0.0');

const requestJson = async (url, body, headers = {}) => {
  const start = nowMs();
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return {
    durationMs: Math.max(0, nowMs() - start),
    ok: response.ok,
    status: response.status,
    body: parsed,
  };
};

const withAuthHeaders = () =>
  ({
    ...(config.anonKey ? { apikey: config.anonKey } : {}),
    ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
  });

const tasks = [];

const sharedState = {
  orderId: config.orderId || '',
  restaurantId: config.restaurantId || '',
};

const addTask = (name, weight, run) => {
  tasks.push({ name, run, weight });
};

const chooseWeightedTask = () => {
  const totalWeight = tasks.reduce((sum, task) => sum + task.weight, 0);
  let cursor = Math.random() * totalWeight;
  for (const task of tasks) {
    cursor -= task.weight;
    if (cursor <= 0) {
      return task;
    }
  }
  return tasks[tasks.length - 1];
};

const publicCatalogAction = async (action, data = {}) => {
  const result = await requestJson(config.publicCatalogUrl, { action, data });
  if (!result.ok) {
    throw new Error(typeof result.body === 'object' && result.body && result.body.error?.message
      ? result.body.error.message
      : `Public catalog ${action} failed with HTTP ${result.status}.`);
  }
  return result.body?.data ?? result.body;
};

const appRpcAction = async (action, data = {}) => {
  if (!config.appRpcUrl) {
    throw new Error('APP_RPC_URL is required for authenticated RPC actions.');
  }

  if (!config.authToken) {
    throw new Error(`AUTH_TOKEN is required for the ${action} action.`);
  }

  const result = await requestJson(
    config.appRpcUrl,
    { action, data },
    withAuthHeaders()
  );
  if (!result.ok) {
    throw new Error(typeof result.body === 'object' && result.body && result.body.error?.message
      ? result.body.error.message
      : `App RPC ${action} failed with HTTP ${result.status}.`);
  }
  return result.body?.data ?? result.body;
};

const notificationsAction = async (payload) => {
  if (!config.notificationsUrl) {
    throw new Error('NOTIFICATIONS_URL is required to test manual notification fan-out.');
  }

  if (!config.authToken) {
    throw new Error('AUTH_TOKEN is required for the notifications action.');
  }

  const result = await requestJson(config.notificationsUrl, payload, withAuthHeaders());
  if (!result.ok) {
    throw new Error(typeof result.body === 'object' && result.body && result.body.error?.message
      ? result.body.error.message
      : `Notifications request failed with HTTP ${result.status}.`);
  }
  return result.body?.data ?? result.body;
};

const queueDrainerAction = async () => {
  if (!config.queueDrainerUrl) {
    throw new Error('QUEUE_DRAINER_URL is required to test queue throughput.');
  }

  if (!config.queueWorkerToken) {
    throw new Error('QUEUE_WORKER_TOKEN is required for the queue drainer.');
  }

  const result = await requestJson(
    config.queueDrainerUrl,
    { batchSize: 10, concurrency: 4, queue: 'all' },
    { 'x-queue-worker-token': config.queueWorkerToken }
  );
  if (!result.ok) {
    throw new Error(typeof result.body === 'object' && result.body && result.body.error?.message
      ? result.body.error.message
      : `Queue drainer failed with HTTP ${result.status}.`);
  }
  return result.body?.data ?? result.body;
};

const warmup = async () => {
  const catalog = await publicCatalogAction('customerGetPublishedRestaurants');
  const restaurantId =
    sharedState.restaurantId ||
    catalog?.restaurants?.[0]?.id ||
    catalog?.restaurant?.id ||
    '';

  if (restaurantId) {
    sharedState.restaurantId = restaurantId;
    await publicCatalogAction('customerGetPublishedRestaurantDetail', { restaurantId });
  }

  if (config.authToken && config.appRpcUrl) {
    const orders = await appRpcAction('customerGetOrders');
    const firstOrderId = orders?.orders?.[0]?.id || '';
    if (firstOrderId) {
      sharedState.orderId = sharedState.orderId || firstOrderId;
      await appRpcAction('customerGetOrderDetail', { orderId: firstOrderId });
    }
  }
};

addTask('public-catalog:list', 10, async () => publicCatalogAction('customerGetPublishedRestaurants'));

addTask('public-catalog:detail', 8, async () => {
  if (!sharedState.restaurantId) {
    return publicCatalogAction('customerGetPublishedRestaurants');
  }
  return publicCatalogAction('customerGetPublishedRestaurantDetail', {
    restaurantId: sharedState.restaurantId,
  });
});

if (config.authToken && config.appRpcUrl) {
  addTask('customerGetOrders', 10, async () => appRpcAction('customerGetOrders'));

  addTask('customerGetOrderDetail', 8, async () => {
    if (!sharedState.orderId) {
      const orders = await appRpcAction('customerGetOrders');
      sharedState.orderId = orders?.orders?.[0]?.id || '';
    }

    if (!sharedState.orderId) {
      throw new Error('No order id available for customerGetOrderDetail.');
    }

    return appRpcAction('customerGetOrderDetail', { orderId: sharedState.orderId });
  });

  if (config.mutationsEnabled && config.initializePaymentDraft) {
    addTask('initializeCustomerPayment', 3, async () => {
      const result = await appRpcAction('initializeCustomerPayment', config.initializePaymentDraft);
      if (result?.orderId) {
        sharedState.orderId = result.orderId;
      }
      return result;
    });
  }

  if (config.mutationsEnabled && config.placeOrderDraft) {
    addTask('placeCustomerOrder', 3, async () => {
      const result = await appRpcAction('placeCustomerOrder', config.placeOrderDraft);
      if (result?.orderId) {
        sharedState.orderId = result.orderId;
      }
      return result;
    });
  }

  if (config.mutationsEnabled) {
    addTask('refreshCustomerPaymentStatus', 2, async () => {
      if (!sharedState.orderId) {
        throw new Error('No order id available for refreshCustomerPaymentStatus.');
      }
      return appRpcAction('refreshCustomerPaymentStatus', { orderId: sharedState.orderId });
    });

    addTask('cancelCustomerOrder', 1, async () => {
      if (!sharedState.orderId) {
        throw new Error('No order id available for cancelCustomerOrder.');
      }
      return appRpcAction('cancelCustomerOrder', { orderId: sharedState.orderId });
    });
  }
}

if (
  config.authToken &&
  config.notificationsUrl &&
  (config.notificationTargetRoles.length > 0 || config.notificationTargetUserIds.length > 0)
) {
  addTask('notifications:fanout', 2, async () =>
    notificationsAction({
      body: config.notificationBody,
      targetRoles: config.notificationTargetRoles,
      targetUserIds: config.notificationTargetUserIds,
      title: config.notificationTitle,
    })
  );
}

if (config.queueDrainerUrl && config.queueWorkerToken) {
  addTask('queue-drainer', 2, queueDrainerAction);
}

if (tasks.length === 0) {
  throw new Error('No load test tasks were configured. Provide the required URLs and tokens.');
}

if (config.mutationsEnabled) {
  console.warn('Mutation load testing is enabled. Make sure the target environment is disposable.');
}

await warmup();

const deadline = Date.now() + config.durationMs;
const workerCount = config.concurrency;

const workerLoop = async () => {
  while (Date.now() < deadline) {
    const task = chooseWeightedTask();
    const started = nowMs();
    try {
      await task.run();
      recordMetric(task.name, Math.max(0, nowMs() - started), true);
    } catch (error) {
      recordMetric(task.name, Math.max(0, nowMs() - started), false, error instanceof Error ? error.message : String(error));
    }
  }
};

const workers = Array.from({ length: workerCount }, () => workerLoop());
await Promise.all(workers);

for (const [name, entry] of stats.entries()) {
  const sample = [...entry.samples];
  const average = entry.count > 0 ? entry.sum / entry.count : 0;
  console.log(
    JSON.stringify({
      action: name,
      averageMs: Number(summarizeNumber(average)),
      count: entry.count,
      errors: entry.errors,
      maxMs: Number(summarizeNumber(entry.max)),
      minMs: Number(summarizeNumber(entry.min)),
      lastError: entry.lastError || null,
      p50Ms: Number(summarizeNumber(percentile(sample, 50))),
      p95Ms: Number(summarizeNumber(percentile(sample, 95))),
      p99Ms: Number(summarizeNumber(percentile(sample, 99))),
    })
  );
}

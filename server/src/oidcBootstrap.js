function toComparableScalar(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function collectScalarValues(value, values = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectScalarValues(item, values));
    return values;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectScalarValues(item, values));
    return values;
  }

  const normalized = toComparableScalar(value);
  if (normalized) {
    values.push(normalized);
  }
  return values;
}

function getClaimValues(rawClaims, claimPath) {
  const pathSegments = String(claimPath || '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (pathSegments.length === 0) {
    return collectScalarValues(rawClaims, []);
  }

  let currentValues = [rawClaims];
  for (const segment of pathSegments) {
    const nextValues = [];
    for (const currentValue of currentValues) {
      if (Array.isArray(currentValue)) {
        currentValue.forEach((item) => {
          if (item && typeof item === 'object' && segment in item) {
            nextValues.push(item[segment]);
          }
        });
        continue;
      }

      if (currentValue && typeof currentValue === 'object' && segment in currentValue) {
        nextValues.push(currentValue[segment]);
      }
    }
    currentValues = nextValues;
  }

  return currentValues.flatMap((value) => collectScalarValues(value, []));
}

export function describeOidcBootstrapRule(rule = '') {
  const normalizedRule = String(rule || '').trim();
  if (!normalizedRule) {
    return 'any OIDC user';
  }
  return normalizedRule;
}

export function matchesOidcBootstrapRule(rawClaims, rule = '') {
  const normalizedRule = String(rule || '').trim();
  if (!normalizedRule) {
    return true;
  }

  const separatorIndex = normalizedRule.indexOf('=');
  if (separatorIndex > 0) {
    const claimPath = normalizedRule.slice(0, separatorIndex).trim();
    const expectedValue = normalizedRule.slice(separatorIndex + 1).trim();
    if (!claimPath || !expectedValue) {
      return false;
    }
    return getClaimValues(rawClaims, claimPath).some((value) => value === expectedValue);
  }

  return collectScalarValues(rawClaims, []).some((value) => value === normalizedRule);
}

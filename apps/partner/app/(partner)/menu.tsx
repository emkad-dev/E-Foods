import { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { usePartnerRestaurant } from '../../src/hooks/usePartnerRestaurant';
import { savePartnerRestaurantMenu, type PartnerMenuCategoryInput } from '../../src/services/partnerRestaurantActions';
import { partnerTheme } from '../../src/theme/palette';

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const MENU_CATEGORY_OPTIONS = [
  { id: 'rice', label: 'Rice' },
  { id: 'swallow', label: 'Swallow' },
  { id: 'soups', label: 'Soups' },
  { id: 'proteins', label: 'Proteins' },
  { id: 'snacks', label: 'Snacks' },
  { id: 'drinks', label: 'Drinks' },
] as const;

type MenuCategoryId = (typeof MENU_CATEGORY_OPTIONS)[number]['id'];

const getMenuCategoryLabel = (categoryId: string) =>
  MENU_CATEGORY_OPTIONS.find((categoryOption) => categoryOption.id === categoryId)?.label ?? 'Rice';

const inferMenuCategoryId = (value: string): MenuCategoryId => {
  const normalizedValue = value.trim().toLowerCase();

  if (/(rice|jollof|ofada|biryani)/.test(normalizedValue)) {
    return 'rice';
  }

  if (/(swallow|amala|eba|fufu|semo|pounded yam)/.test(normalizedValue)) {
    return 'swallow';
  }

  if (/(soup|egusi|efo|ogbono|banga|okra|oha|afang)/.test(normalizedValue)) {
    return 'soups';
  }

  if (/(chicken|beef|fish|turkey|goat|suya|protein|meat)/.test(normalizedValue)) {
    return 'proteins';
  }

  if (/(drink|juice|water|soda|zobo|smoothie|tea|coffee)/.test(normalizedValue)) {
    return 'drinks';
  }

  return 'snacks';
};

const normalizeMenuItemCategory = (categoryName: string, item: { categoryId?: string; categoryLabel?: string }) => {
  const existingCategoryId = MENU_CATEGORY_OPTIONS.find((categoryOption) => categoryOption.id === item.categoryId)?.id;
  const categoryId = existingCategoryId ?? inferMenuCategoryId(item.categoryLabel ?? categoryName);

  return {
    categoryId,
    categoryLabel: item.categoryLabel ?? getMenuCategoryLabel(categoryId),
  };
};

export default function PartnerMenuScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { error, loading, restaurant } = usePartnerRestaurant();
  const [saving, setSaving] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<MenuCategoryId>('rice');
  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemImage, setItemImage] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);

  const menu = useMemo(() => restaurant?.menu ?? [], [restaurant?.menu]);
  const totalMeals = useMemo(() => menu.reduce((sum, menuCategory) => sum + menuCategory.items.length, 0), [menu]);
  const availableMeals = useMemo(
    () =>
      menu.reduce(
        (sum, menuCategory) => sum + menuCategory.items.filter((item) => item.isAvailable !== false).length,
        0
      ),
    [menu]
  );

  const resetForm = () => {
    setEditingItemId(null);
    setCategoryId('rice');
    setItemName('');
    setItemDescription('');
    setItemPrice('');
    setItemImage('');
    setIsAvailable(true);
  };

  const handleSaveItem = async () => {
    if (!restaurant?.id || !user) {
      Alert.alert('Store setup needed', 'Create or link a restaurant record on the Store tab before adding meals.');
      return;
    }

    if (!categoryId || !itemName.trim() || !itemPrice.trim()) {
      Alert.alert('Missing details', 'Add a category, meal name, and price before saving.');
      return;
    }

    const parsedPrice = Number.parseFloat(itemPrice);

    if (!Number.isFinite(parsedPrice)) {
      Alert.alert('Invalid price', 'Use a valid numeric price for this meal.');
      return;
    }

    setSaving(true);

    try {
      const normalizedCategory = getMenuCategoryLabel(categoryId);
      const itemId = editingItemId ?? `${toSlug(itemName)}-${Date.now()}`;
      const nextMenu: PartnerMenuCategoryInput[] = [...menu].map((menuCategory) => ({
        category: menuCategory.category,
        items: menuCategory.items.map((item) => {
          const normalizedItemCategory = normalizeMenuItemCategory(menuCategory.category, item);

          return {
            ...item,
            ...normalizedItemCategory,
            description: item.description ?? '',
          };
        }),
      }));
      const categoryIndex = nextMenu.findIndex(
        (menuCategory) =>
          menuCategory.category.trim().toLowerCase() === normalizedCategory.toLowerCase() ||
          menuCategory.items.some((item) => item.categoryId === categoryId)
      );

      const nextItem = {
        id: itemId,
        name: itemName.trim(),
        description: itemDescription.trim(),
        price: parsedPrice,
        categoryId,
        categoryLabel: normalizedCategory,
        image: itemImage.trim() || undefined,
        isAvailable,
      };

      if (categoryIndex >= 0) {
        const existingItemIndex = nextMenu[categoryIndex].items.findIndex((item) => item.id === itemId);

        if (existingItemIndex >= 0) {
          nextMenu[categoryIndex].items[existingItemIndex] = nextItem;
        } else {
          nextMenu[categoryIndex].items.push(nextItem);
        }
      } else {
        nextMenu.push({
          category: normalizedCategory,
          items: [nextItem],
        });
      }

      await savePartnerRestaurantMenu(restaurant.id, nextMenu);
      resetForm();
      Alert.alert('Menu saved', `${nextItem.name} is now available in ${normalizedCategory}.`);
    } catch (nextError: any) {
      Alert.alert('Save failed', nextError.message ?? 'Unable to save this menu item right now.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditItem = (
    categoryName: string,
    item: {
      description?: string;
      id: string;
      image?: string;
      isAvailable?: boolean;
      name: string;
      price: number;
      categoryId?: string;
      categoryLabel?: string;
    }
  ) => {
    setEditingItemId(item.id);
    const nextCategoryId = MENU_CATEGORY_OPTIONS.find(
      (categoryOption) =>
        categoryOption.id === item.categoryId ||
        categoryOption.label.toLowerCase() === (item.categoryLabel ?? categoryName).trim().toLowerCase() ||
        categoryOption.label.toLowerCase() === categoryName.trim().toLowerCase()
    )?.id;
    setCategoryId(nextCategoryId ?? inferMenuCategoryId(item.categoryLabel ?? categoryName));
    setItemName(item.name);
    setItemDescription(item.description ?? '');
    setItemPrice(String(item.price));
    setItemImage(item.image ?? '');
    setIsAvailable(item.isAvailable !== false);
  };

  const handleRemoveItem = async (categoryName: string, itemId: string) => {
    if (!restaurant?.id || !user) {
      return;
    }

    setSaving(true);

    try {
      const nextMenu = menu
        .map((menuCategory) => {
          if (menuCategory.category !== categoryName) {
            return {
              category: menuCategory.category,
              items: menuCategory.items.map((item) => {
                const normalizedItemCategory = normalizeMenuItemCategory(menuCategory.category, item);

                return {
                  ...item,
                  ...normalizedItemCategory,
                  description: item.description ?? '',
                };
              }),
            };
          }

          return {
            ...menuCategory,
            items: menuCategory.items
              .filter((item) => item.id !== itemId)
              .map((item) => {
                const normalizedItemCategory = normalizeMenuItemCategory(menuCategory.category, item);

                return {
                  ...item,
                  ...normalizedItemCategory,
                  description: item.description ?? '',
                };
              }),
          };
        })
        .filter((menuCategory) => menuCategory.items.length > 0);

      await savePartnerRestaurantMenu(restaurant.id, nextMenu);

      if (editingItemId === itemId) {
        resetForm();
      }
    } catch (nextError: any) {
      Alert.alert('Remove failed', nextError.message ?? 'Unable to remove this meal right now.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>Menu builder</Text>
      <Text style={styles.subtitle}>
        Shape the dishes customers will see first. Keep names clean, pricing accurate, and descriptions short enough to scan fast.
      </Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.summaryCard}>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue}>{menu.length}</Text>
          <Text style={styles.summaryLabel}>Categories</Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue}>{totalMeals}</Text>
          <Text style={styles.summaryLabel}>Meals</Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue}>{availableMeals}</Text>
          <Text style={styles.summaryLabel}>Live now</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Meal editor</Text>
        {!restaurant ? (
          <Text style={styles.emptyCopy}>Set up or link a restaurant on the Store tab before building a menu.</Text>
        ) : null}
        <View style={styles.editorIntro}>
          <Text style={styles.editorIntroTitle}>
            {editingItemId ? 'Update this meal listing' : 'Build a meal customers can trust'}
          </Text>
          <Text style={styles.editorIntroCopy}>
            Pick the food category customers should find this meal under, then add a sharp title and short description.
          </Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Category</Text>
          <Text style={styles.fieldHint}>Choose the customer-facing food group for this meal.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryPickerRow}>
            {MENU_CATEGORY_OPTIONS.map((categoryOption) => {
              const active = categoryId === categoryOption.id;
              return (
                <TouchableOpacity
                  key={categoryOption.id}
                  style={[styles.categoryPickerChip, active ? styles.categoryPickerChipActive : null]}
                  onPress={() => setCategoryId(categoryOption.id)}
                >
                  <Text style={active ? styles.categoryPickerChipTextActive : styles.categoryPickerChipText}>
                    {categoryOption.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Meal name</Text>
          <Text style={styles.fieldHint}>Write the exact name you want customers to remember and reorder.</Text>
          <TextInput
            style={styles.input}
            placeholder="Examples: Chicken Shawarma Wrap, Smoky Jollof Bowl"
            placeholderTextColor={partnerTheme.textMuted}
            value={itemName}
            onChangeText={setItemName}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Meal description</Text>
          <Text style={styles.fieldHint}>Keep it short and appetizing: ingredients, spice level, portion style, or what comes with it.</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Examples: Grilled chicken, crunchy vegetables, house sauce, and soft flatbread."
            placeholderTextColor={partnerTheme.textMuted}
            value={itemDescription}
            onChangeText={setItemDescription}
            multiline
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Price</Text>
          <Text style={styles.fieldHint}>Enter the full selling price in naira without commas.</Text>
          <TextInput
            style={styles.input}
            placeholder="Examples: 4500 or 12500"
            placeholderTextColor={partnerTheme.textMuted}
            value={itemPrice}
            onChangeText={setItemPrice}
            keyboardType="decimal-pad"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Image URL</Text>
          <Text style={styles.fieldHint}>Optional, but helpful when you already have a good hosted photo for the dish.</Text>
          <TextInput
            style={styles.input}
            placeholder="Example: https://yourcdn.com/meals/chicken-shawarma.jpg"
            placeholderTextColor={partnerTheme.textMuted}
            value={itemImage}
            onChangeText={setItemImage}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleLabel}>Available for ordering</Text>
            <Text style={styles.toggleHint}>Turn this off if the meal is sold out or paused for now.</Text>
          </View>
          <Switch
            value={isAvailable}
            onValueChange={setIsAvailable}
            trackColor={{ false: '#d1d5db', true: partnerTheme.accentSoft }}
            thumbColor={isAvailable ? partnerTheme.accent : '#f3f4f6'}
          />
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.primaryButton, !restaurant ? styles.primaryButtonDisabled : null]}
            onPress={handleSaveItem}
            disabled={!restaurant || saving || loading}
          >
            <Text style={styles.primaryButtonText}>
              {saving ? 'Saving...' : editingItemId ? 'Save meal changes' : 'Add meal'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={resetForm} disabled={saving}>
            <Text style={styles.secondaryButtonText}>{editingItemId ? 'Cancel edit' : 'Reset form'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Live menu</Text>
        <Text style={styles.cardSubtitle}>This is the structure your customer-facing menu will follow once the restaurant is published.</Text>
        {menu.length === 0 ? (
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyPanelTitle}>No categories yet</Text>
            <Text style={styles.emptyCopy}>Start with one strong category and one complete meal so the menu feels intentional from the first save.</Text>
          </View>
        ) : null}
        {menu.map((menuCategory) => (
          <View key={menuCategory.category} style={styles.categoryBlock}>
            <View style={styles.categoryHeader}>
              <Text style={styles.categoryTitle}>{menuCategory.category}</Text>
              <View style={styles.categoryCountPill}>
                <Text style={styles.categoryCountText}>
                  {menuCategory.items.length} {menuCategory.items.length === 1 ? 'meal' : 'meals'}
                </Text>
              </View>
            </View>
            {menuCategory.items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.itemMeta}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemInfo}>
                    ₦{item.price.toFixed(2)} | {item.categoryLabel ?? menuCategory.category} |{' '}
                    {item.isAvailable === false ? 'Unavailable' : 'Available'}
                  </Text>
                  {item.description ? <Text style={styles.itemDescription}>{item.description}</Text> : null}
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity style={styles.inlineAction} onPress={() => handleEditItem(menuCategory.category, item)}>
                    <Text style={styles.inlineActionText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.inlineAction, styles.inlineDanger]}
                    onPress={() => handleRemoveItem(menuCategory.category, item.id)}
                    disabled={saving}
                  >
                    <Text style={[styles.inlineActionText, styles.inlineDangerText]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    paddingBottom: 30,
    paddingHorizontal: 18,
  },
  title: {
    color: partnerTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 13,
    marginTop: 12,
  },
  summaryCard: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  summaryPill: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  summaryValue: {
    color: partnerTheme.text,
    fontSize: 20,
    fontWeight: '800',
  },
  summaryLabel: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderRadius: 20,
    marginTop: 14,
    padding: 18,
  },
  cardTitle: {
    color: partnerTheme.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  cardSubtitle: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: -4,
    marginBottom: 6,
  },
  editorIntro: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  editorIntroTitle: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  editorIntroCopy: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  fieldGroup: {
    marginTop: 10,
  },
  fieldLabel: {
    color: partnerTheme.text,
    fontSize: 14,
    fontWeight: '800',
  },
  fieldHint: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  categoryPickerRow: {
    paddingRight: 12,
    paddingTop: 8,
  },
  categoryPickerChip: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  categoryPickerChipActive: {
    backgroundColor: partnerTheme.accent,
    borderColor: partnerTheme.accent,
  },
  categoryPickerChipText: {
    color: partnerTheme.text,
    fontSize: 12,
    fontWeight: '800',
  },
  categoryPickerChipTextActive: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  input: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 14,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  toggleCopy: {
    flex: 1,
    paddingRight: 16,
  },
  toggleLabel: {
    color: partnerTheme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  toggleHint: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  actionRow: {
    gap: 10,
    marginTop: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 16,
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 16,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  emptyCopy: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  emptyPanel: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  emptyPanelTitle: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  categoryBlock: {
    borderTopColor: partnerTheme.border,
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 14,
  },
  categoryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  categoryTitle: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  categoryCountPill: {
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryCountText: {
    color: partnerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  itemRow: {
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  itemMeta: {
    flex: 1,
  },
  itemName: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  itemInfo: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    marginTop: 4,
  },
  itemDescription: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  inlineAction: {
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineActionText: {
    color: partnerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  inlineDanger: {
    backgroundColor: '#fee2e2',
  },
  inlineDangerText: {
    color: partnerTheme.danger,
  },
});

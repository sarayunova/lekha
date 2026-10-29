<template>
  <button
    class="rounded-md flex justify-center items-center text-sm"
    :disabled="disabled"
    :class="_class"
    v-bind="$attrs"
  >
    <slot></slot>
  </button>
</template>
<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'Button',
  props: {
    type: {
      type: String,
      default: 'secondary',
    },
    icon: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    padding: {
      type: Boolean,
      default: true,
    },
    background: {
      type: Boolean,
      default: true,
    },
  },
  computed: {
    _class() {
      return {
        'opacity-50 cursor-not-allowed pointer-events-none': this.disabled,
        'text-white font-medium': this.type === 'primary',
        'bg-blue-600 hover:bg-blue-700 shadow-button dark:bg-blue-500 dark:hover:bg-blue-600':
          this.type === 'primary' && this.background,
        'text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-white':
          this.type !== 'primary',
        'bg-gray-100 hover:bg-gray-200 dark:bg-gray-850 dark:hover:bg-gray-800':
          this.type !== 'primary' && this.background,
        'h-8': this.background,
        'px-3': this.padding && this.icon,
        'px-6': this.padding && !this.icon,
      };
    },
  },
});
</script>
<style scoped>
button:focus-visible {
  outline: none;
  box-shadow: theme('boxShadow.ring');
}
button:active {
  transform: translateY(0.5px);
}
</style>

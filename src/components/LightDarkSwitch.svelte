<script lang="ts">
import { AUTO_MODE, DARK_MODE, DEFAULT_THEME, LIGHT_MODE } from "@constants/constants.ts";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@iconify/svelte";
import moon from "@iconify-icons/lucide/moon";
import sun from "@iconify-icons/lucide/sun";
import sunMoon from "@iconify-icons/lucide/sun-moon";
import { getStoredTheme, setTheme } from "@utils/setting-utils.ts";
import { onMount } from "svelte";
import type { LIGHT_DARK_MODE } from "@/types/config.ts";

// The stored choice (light | dark | auto). The OS is only followed for auto, which only the panel's System sets.
let mode: LIGHT_DARK_MODE = DEFAULT_THEME;

onMount(() => {
	mode = getStoredTheme();
});

function switchScheme(newMode: LIGHT_DARK_MODE) {
	mode = newMode;
	setTheme(newMode);
}

// The button flips what is shown (light <-> dark). It never picks System, so a click cannot put the site on auto.
function toggleScheme() {
	switchScheme(window.siteTheme.dark() ? LIGHT_MODE : DARK_MODE);
}

function showPanel() {
	const panel = document.querySelector("#light-dark-panel");
	panel.classList.remove("float-panel-closed");
}

function hidePanel() {
	const panel = document.querySelector("#light-dark-panel");
	panel.classList.add("float-panel-closed");
}
</script>

<!-- z-50 make the panel higher than other float panels -->
<div class="relative z-50" role="menu" tabindex="-1" onmouseleave={hidePanel}>
    <button aria-label="Light/Dark Mode" role="menuitem" class="relative btn-plain scale-animation rounded-lg h-11 w-11 active:scale-90" id="scheme-switch" onclick={toggleScheme} onmouseenter={showPanel}>
        <div class="absolute" class:opacity-0={mode !== LIGHT_MODE}>
            <Icon icon={sun} class="text-[1.25rem]"></Icon>
        </div>
        <div class="absolute" class:opacity-0={mode !== DARK_MODE}>
            <Icon icon={moon} class="text-[1.25rem]"></Icon>
        </div>
        <div class="absolute" class:opacity-0={mode !== AUTO_MODE}>
            <Icon icon={sunMoon} class="text-[1.25rem]"></Icon>
        </div>
    </button>

    <div id="light-dark-panel" class="hidden lg:block absolute transition float-panel-closed top-11 -right-2 pt-5" >
        <div class="card-base float-panel p-2">
            <button class="flex transition whitespace-nowrap items-center !justify-start w-full btn-plain scale-animation rounded-lg h-9 px-3 font-medium active:scale-95 mb-0.5"
                    class:current-theme-btn={mode === LIGHT_MODE}
                    onclick={() => switchScheme(LIGHT_MODE)}
            >
                <Icon icon={sun} class="text-[1.25rem] mr-3"></Icon>
                {i18n(I18nKey.lightMode)}
            </button>
            <button class="flex transition whitespace-nowrap items-center !justify-start w-full btn-plain scale-animation rounded-lg h-9 px-3 font-medium active:scale-95 mb-0.5"
                    class:current-theme-btn={mode === DARK_MODE}
                    onclick={() => switchScheme(DARK_MODE)}
            >
                <Icon icon={moon} class="text-[1.25rem] mr-3"></Icon>
                {i18n(I18nKey.darkMode)}
            </button>
            <button class="flex transition whitespace-nowrap items-center !justify-start w-full btn-plain scale-animation rounded-lg h-9 px-3 font-medium active:scale-95"
                    class:current-theme-btn={mode === AUTO_MODE}
                    onclick={() => switchScheme(AUTO_MODE)}
            >
                <Icon icon={sunMoon} class="text-[1.25rem] mr-3"></Icon>
                {i18n(I18nKey.systemMode)}
            </button>
        </div>
    </div>
</div>

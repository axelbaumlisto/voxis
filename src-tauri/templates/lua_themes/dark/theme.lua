-- Dark Purple Theme
-- Purple → Pink → White gradient

gradient = {
    bottom = {80, 40, 160},         -- Deep purple
    middle = {124, 77, 255},        -- #7c4dff purple
    top = {179, 136, 255}           -- #b388ff light purple
}

gradient_transcribing = {
    bottom = {30, 120, 80},         -- Dark teal
    middle = {105, 240, 174},       -- #69f0ae mint green
    top = {180, 255, 220}           -- Light mint
}

function lerp(a, b, t)
    return a + (b - a) * t
end

function lerp_color(c1, c2, t)
    return {
        lerp(c1[1], c2[1], t),
        lerp(c1[2], c2[2], t),
        lerp(c1[3], c2[3], t)
    }
end

function gradient_color(grad, t)
    t = math.max(0, math.min(1, t))
    if t < 0.5 then
        return lerp_color(grad.bottom, grad.middle, t * 2)
    else
        return lerp_color(grad.middle, grad.top, (t - 0.5) * 2)
    end
end

function render(ctx, state, data)
    local w, h = ctx:size()
    local center_y = h / 2
    local max_h = h * 0.8

    if state == "idle" then
        ctx:set_color(gradient.middle)
        ctx:draw_line(10, center_y, w - 10, center_y, 2)

    elseif state == "recording" then
        -- Waveform bars with purple gradient
        local bar_count = 32
        local bar_width = w / bar_count * 0.8
        local spacing = w / bar_count

        for i = 1, bar_count do
            local level = data.levels[i] or 0
            local amp = math.min(1, math.sqrt(level * 8))
            local bar_h = math.max(2, amp * max_h)

            local x = (i - 0.5) * spacing
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local t = (seg * seg_h) / max_h
                ctx:set_color(gradient_color(gradient, t))
                ctx:draw_rect(x - bar_width / 2, y, bar_width, seg_h)
            end
        end

    elseif state == "transcribing" then
        -- Breathing pulse: 32 bars with mint gradient, cubic ease-in-out
        local bar_count = 32
        local bar_width = w / bar_count * 0.8
        local spacing = w / bar_count

        -- Cubic ease-in-out for smooth breathing
        local t = (math.sin(data.phase * 0.8) + 1) / 2
        local ease
        if t < 0.5 then
            ease = 4 * t * t * t
        else
            ease = 1 - math.pow(-2 * t + 2, 3) / 2
        end

        for i = 1, bar_count do
            -- Bell curve: bars in center are taller
            local norm = (i - 0.5) / bar_count
            local bell = math.exp(-((norm - 0.5) * 3) ^ 2)
            local bar_h = math.max(2, bell * ease * max_h * 0.8)

            local x = (i - 0.5) * spacing
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local gt = (seg * seg_h) / max_h
                ctx:set_color(gradient_color(gradient_transcribing, gt))
                ctx:draw_rect(x - bar_width / 2, y, bar_width, seg_h)
            end
        end
    end
end

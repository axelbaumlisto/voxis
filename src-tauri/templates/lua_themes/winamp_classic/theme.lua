-- Winamp Classic Theme
-- Fire gradient: green -> yellow -> red

colors = {
    idle = {30, 136, 229},
    recording = {239, 49, 16},
    transcribing = {41, 206, 16}
}

gradient = {
    bottom = {41, 148, 0},    -- Green
    middle = {214, 181, 33},  -- Yellow/Gold
    top = {239, 49, 16}       -- Red
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

function gradient_color(t)
    t = math.max(0, math.min(1, t))
    if t < 0.5 then
        return lerp_color(gradient.bottom, gradient.middle, t * 2)
    else
        return lerp_color(gradient.middle, gradient.top, (t - 0.5) * 2)
    end
end

function render(ctx, state, data)
    local w, h = ctx:size()
    local center_y = h / 2
    local max_h = h * 0.8

    if state == "idle" then
        ctx:set_color(colors.idle)
        ctx:draw_line(20, center_y, w - 20, center_y, 2)

    elseif state == "recording" then
        local bar_count = 32
        local bar_width = 4
        local gap = 2
        local total = bar_count * (bar_width + gap) - gap
        local start_x = (w - total) / 2

        for i = 1, bar_count do
            local level = data.levels[i] or 0
            local amp = math.min(1, math.sqrt(level * 8))
            local bar_h = math.max(2, amp * max_h)

            local x = start_x + (i - 1) * (bar_width + gap)

            -- Draw gradient bar (segment by segment)
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local t = (seg * seg_h) / max_h
                local color = gradient_color(t)

                ctx:set_color(color)
                ctx:draw_rect(x, y, bar_width, seg_h)
            end
        end

    elseif state == "transcribing" then
        -- Bouncing equalizer: 32 bars matching recording layout
        local bar_count = 32
        local bar_width = 4
        local gap = 2
        local total = bar_count * (bar_width + gap) - gap
        local start_x = (w - total) / 2

        for i = 1, bar_count do
            local freq = 1.2 + i * 0.3
            local phase_off = i * 0.7
            local bounce = math.abs(math.sin(data.time * freq + phase_off))
            local bar_h = math.max(2, bounce * max_h * 0.85)

            local x = start_x + (i - 1) * (bar_width + gap)

            -- Draw gradient bar segment by segment (green → yellow → red)
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local t = (seg * seg_h) / max_h
                local color = gradient_color(t)

                ctx:set_color(color)
                ctx:draw_rect(x, y, bar_width, seg_h)
            end
        end
    end
end
